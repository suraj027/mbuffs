/**
 * Reddit Scraper Script - Runs at build time to populate Reddit recommendations
 * 
 * This script is designed to run during Vercel build to scrape movie recommendations
 * from Reddit and store them in the database. Since serverless functions can't run
 * long background tasks, we do this at build time instead.
 * 
 * Cache behavior:
 * - Only scrapes if data is older than CACHE_TTL_HOURS
 * - Use --force flag to bypass cache check
 */

import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';

dotenv.config();

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Subreddits to scrape for movie recommendations
 * 
 * Selection rationale:
 * - MovieSuggestions: Primary recommendation subreddit, users explicitly ask for and give movie suggestions
 * - movies: Large general movie discussion, lots of "what should I watch" threads
 * - flicks: Smaller but quality-focused movie discussion community
 * - TrueFilm: More serious/analytical film discussion, good for finding hidden gems
 * - horror: Genre-specific, great for horror recommendations
 * - scifi: Genre-specific, good for sci-fi recommendations
 * - televisionsuggestions: TV show recommendations
 * 
 * You can customize this via REDDIT_SUBREDDITS env var (comma-separated)
 * Example: REDDIT_SUBREDDITS=MovieSuggestions,horror,scifi
 */
const DEFAULT_SUBREDDITS = [
    'MovieSuggestions',    // ~2M members - dedicated recommendation sub
    'movies',              // ~35M members - general movie discussion
    'flicks',              // ~150K members - quality movie discussion
    'TrueFilm',            // ~1.5M members - analytical film discussion
    'horror',              // ~3M members - horror genre
    'scifi',               // ~2M members - sci-fi genre
    'romancemovies',
    'Cinema',
    'TheBigPicture',
    'NetflixBestOf',
    'Letterboxd',
    'netflix',
    'moviecritic',
    'AskReddit', // For "What movie should I watch?" threads
    'CineSeries',
    'televisionsuggestions', // TV recommendations
];

// Parse subreddits from env or use defaults
const MOVIE_SUBREDDITS = process.env.REDDIT_SUBREDDITS
    ? process.env.REDDIT_SUBREDDITS.split(',').map(s => s.trim()).filter(Boolean)
    : DEFAULT_SUBREDDITS;

const POSTS_PER_SUBREDDIT = parseInt(process.env.REDDIT_POSTS_PER_SUB || '25', 10);
const MIN_SCORE = parseInt(process.env.REDDIT_MIN_SCORE || '10', 10);
const TIMEFRAME = process.env.REDDIT_TIMEFRAME || 'all'; // hour, day, week, month, year, all

// Cache configuration - only re-scrape if data is older than this (default: 1 month)
const CACHE_TTL_HOURS = parseInt(process.env.REDDIT_CACHE_TTL_HOURS || '720', 10); // 720 hours = 30 days

// Generate a hash of the subreddit list to detect config changes
const SUBREDDITS_HASH = MOVIE_SUBREDDITS.slice().sort().join(',').toLowerCase();

// Rate limiting - Reddit allows ~10 req/min for unauthenticated
const DELAY_BETWEEN_REQUESTS = 2000; // 2 seconds between comment fetches
const DELAY_BETWEEN_SUBREDDITS = 3000; // 3 seconds between subreddits

// Check for --force flag
const FORCE_SCRAPE = process.argv.includes('--force');

// ============================================================================
// HELPERS
// ============================================================================

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function generateId(length = 15) {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return result;
}

// Reddit rate limit: ~10 requests per minute for unauthenticated
const REDDIT_MAX_RETRIES = 3;

async function fetchRedditJson(url, retryCount = 0) {
    try {
        const jsonUrl = url.endsWith('.json') ? url : `${url}.json`;
        
        const response = await fetch(jsonUrl, {
            headers: {
                'User-Agent': 'mbuffs:v1.0 (movie recommendation app)',
                'Accept': 'application/json',
            },
        });

        if (!response.ok) {
            if (response.status === 429 && retryCount < REDDIT_MAX_RETRIES) {
                const delay = 10000 * (retryCount + 1); // 10s, 20s, 30s
                console.warn(`  Reddit rate limit hit, waiting ${delay/1000}s (retry ${retryCount + 1}/${REDDIT_MAX_RETRIES})...`);
                await sleep(delay);
                return fetchRedditJson(url, retryCount + 1);
            }
            console.error(`  Reddit API error: ${response.status} for ${url}`);
            return null;
        }

        return await response.json();
    } catch (error) {
        console.error(`  Error fetching Reddit data from ${url}:`, error.message);
        return null;
    }
}

// ============================================================================
// AI-POWERED MOVIE EXTRACTION (OpenRouter)
// ============================================================================

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const AI_MODEL = process.env.OPENROUTER_MODEL || 'openai/gpt-oss-120b:free';

// Retry configuration for rate limits
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 2000; // 2 seconds

/**
 * Make an API call with retry logic for rate limits
 */
async function fetchWithRetry(url, options, retries = MAX_RETRIES) {
    for (let attempt = 0; attempt <= retries; attempt++) {
        const response = await fetch(url, options);
        
        if (response.ok) {
            return response;
        }
        
        // Handle rate limiting (429)
        if (response.status === 429 && attempt < retries) {
            const delay = INITIAL_RETRY_DELAY * Math.pow(2, attempt); // Exponential backoff
            console.warn(`  Rate limited, waiting ${delay/1000}s before retry ${attempt + 1}/${retries}...`);
            await sleep(delay);
            continue;
        }
        
        // For other errors or final retry, return the response as-is
        return response;
    }
}

/**
 * Use AI to extract movie/show names from text
 * Returns array of { title, year?, sentiment }
 */
async function extractMoviesWithAI(texts) {
    if (!OPENROUTER_API_KEY) {
        console.warn('  OPENROUTER_API_KEY not set, skipping AI extraction');
        return [];
    }

    // Combine texts and truncate to avoid token limits
    const combinedText = texts
        .map(t => t.text.substring(0, 500))
        .join('\n---\n')
        .substring(0, 8000);

    if (!combinedText.trim()) {
        return [];
    }

    const prompt = `Extract all movie and TV show titles mentioned in the following Reddit posts/comments. 
These are from movie recommendation subreddits, so users are recommending films to watch.

For each title found, provide:
- title: The exact movie/show name
- year: Release year if mentioned (optional)
- sentiment: "positive" if recommended/praised, "negative" if criticized, "neutral" otherwise

Return ONLY a JSON array, no other text. Example:
[{"title": "The Shawshank Redemption", "year": 1994, "sentiment": "positive"}, {"title": "Inception", "sentiment": "neutral"}]

If no movies/shows are found, return an empty array: []

Text to analyze:
${combinedText}`;

    try {
        const response = await fetchWithRetry('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': process.env.FRONTEND_URL || 'http://localhost:8080',
                'X-Title': 'mbuffs',
            },
            body: JSON.stringify({
                model: AI_MODEL,
                messages: [
                    {
                        role: 'user',
                        content: prompt,
                    },
                ],
                temperature: 0.1,
                max_tokens: 2000,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            // Only log if not a rate limit (we already logged retries)
            if (response.status !== 429) {
                console.error(`  OpenRouter API error: ${response.status} - ${errorText}`);
            }
            return [];
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '';
        
        if (!content.trim()) {
            return [];
        }
        
        // Parse JSON from response (handle markdown code blocks and other text)
        let jsonStr = content.trim();
        
        // Remove markdown code blocks
        if (jsonStr.includes('```')) {
            jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
        }
        
        // Try to find JSON array in the response
        const arrayMatch = jsonStr.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
            jsonStr = arrayMatch[0];
        } else {
            // No array found
            return [];
        }
        
        // Clean up common JSON issues
        jsonStr = jsonStr
            .replace(/,\s*]/g, ']')  // Remove trailing commas
            .replace(/,\s*}/g, '}'); // Remove trailing commas in objects
        
        const movies = JSON.parse(jsonStr);
        
        if (!Array.isArray(movies)) {
            return [];
        }

        return movies.filter(m => m.title && typeof m.title === 'string');
    } catch (error) {
        // Only log if it's not a simple parsing issue
        if (!error.message.includes('JSON')) {
            console.error(`  AI extraction error: ${error.message}`);
        }
        return [];
    }
}

/**
 * Batch texts for AI processing to reduce API calls
 * Groups texts into batches of ~10 for efficiency
 */
function batchTextsForAI(posts, comments) {
    const allTexts = [];
    
    // Add post titles and bodies
    for (const post of posts) {
        if (post.title) {
            allTexts.push({ text: post.title, score: post.score, postId: post.id, postTitle: post.title });
        }
        if (post.selftext && post.selftext.length > 20) {
            allTexts.push({ text: post.selftext, score: post.score, postId: post.id, postTitle: post.title });
        }
    }
    
    // Add comments
    for (const comment of comments) {
        if (comment.body && comment.body.length > 10) {
            allTexts.push({ 
                text: comment.body, 
                score: comment.score, 
                postId: comment.postId, 
                postTitle: comment.postTitle 
            });
        }
    }
    
    // Batch into large groups to minimize API calls (free tier: 20 requests/min)
    // With ~1000 texts and batch size of 50, we get ~20 batches
    const BATCH_SIZE = 50;
    const batches = [];
    for (let i = 0; i < allTexts.length; i += BATCH_SIZE) {
        batches.push(allTexts.slice(i, i + BATCH_SIZE));
    }
    
    return batches;
}

// ============================================================================
// TMDB INTEGRATION
// ============================================================================

async function searchTMDB(title, year, mediaType = 'movie') {
    const TMDB_API_KEY = process.env.TMDB_API_KEY;
    const TMDB_BASE_URL = process.env.TMDB_BASE_URL || 'https://api.themoviedb.org/3';

    if (!TMDB_API_KEY) {
        return null;
    }

    try {
        let url = new URL(`${TMDB_BASE_URL}/search/${mediaType}`);
        url.searchParams.append('api_key', TMDB_API_KEY);
        url.searchParams.append('query', title);
        if (year) {
            url.searchParams.append(mediaType === 'movie' ? 'year' : 'first_air_date_year', year.toString());
        }

        let response = await fetch(url.toString());
        if (response.ok) {
            const data = await response.json();
            if (data.results && data.results.length > 0) {
                return { tmdbId: data.results[0].id.toString(), mediaType };
            }
        }

        // Try TV if movie fails
        if (mediaType === 'movie') {
            url = new URL(`${TMDB_BASE_URL}/search/tv`);
            url.searchParams.append('api_key', TMDB_API_KEY);
            url.searchParams.append('query', title);
            
            response = await fetch(url.toString());
            if (response.ok) {
                const data = await response.json();
                if (data.results && data.results.length > 0) {
                    return { tmdbId: data.results[0].id.toString(), mediaType: 'tv' };
                }
            }
        }

        return null;
    } catch (error) {
        console.error(`Error searching TMDB for "${title}":`, error.message);
        return null;
    }
}

// ============================================================================
// MAIN SCRAPING LOGIC
// ============================================================================

async function fetchSubredditPosts(subreddit) {
    const url = `https://www.reddit.com/r/${subreddit}/top.json?t=${TIMEFRAME}&limit=${POSTS_PER_SUBREDDIT}`;
    const response = await fetchRedditJson(url);

    if (!response?.data?.children) {
        return [];
    }

    return response.data.children
        .map(child => ({
            id: child.data.id,
            title: child.data.title,
            selftext: child.data.selftext,
            subreddit: child.data.subreddit,
            score: child.data.score,
            numComments: child.data.num_comments,
            permalink: child.data.permalink,
            url: `https://www.reddit.com${child.data.permalink}`,
        }))
        .filter(p => p.score >= MIN_SCORE);
}

/**
 * Fetch top comments from a post
 * Many movie recommendations are in comments, not post body
 */
async function fetchPostComments(subreddit, postId, limit = 50) {
    const url = `https://www.reddit.com/r/${subreddit}/comments/${postId}.json?limit=${limit}&depth=1&sort=top`;
    const response = await fetchRedditJson(url);

    if (!response || !Array.isArray(response) || response.length < 2) {
        return [];
    }

    const comments = [];
    const commentsData = response[1]?.data?.children || [];
    
    for (const child of commentsData) {
        if (child.kind === 't1' && child.data.body) {
            comments.push({
                id: child.data.id,
                body: child.data.body,
                score: child.data.score || 0,
                author: child.data.author,
            });
        }
    }

    return comments.filter(c => c.score >= 5); // Only comments with decent upvotes
}

// How many posts to fetch comments from (top N by comment count)
const POSTS_TO_FETCH_COMMENTS = 5;

async function scrapeReddit() {
    console.log('Starting Reddit scrape...');
    
    if (!OPENROUTER_API_KEY) {
        console.error('ERROR: OPENROUTER_API_KEY is required for AI-powered extraction');
        console.error('Get a free API key at https://openrouter.ai/');
        process.exit(1);
    }
    
    const allPosts = [];
    const allComments = [];
    let totalPostsScraped = 0;
    let totalCommentsScraped = 0;

    // Phase 1: Collect all posts and comments from Reddit
    for (const subreddit of MOVIE_SUBREDDITS) {
        console.log(`  Fetching r/${subreddit}...`);
        
        const posts = await fetchSubredditPosts(subreddit);
        totalPostsScraped += posts.length;
        
        // Add subreddit info to posts
        posts.forEach(p => {
            p.subreddit = subreddit;
            allPosts.push(p);
        });

        // Sort by comment count to find discussion-heavy posts
        const postsForComments = [...posts]
            .sort((a, b) => b.numComments - a.numComments)
            .slice(0, POSTS_TO_FETCH_COMMENTS);

        // Fetch comments from top posts
        for (const post of postsForComments) {
            const comments = await fetchPostComments(subreddit, post.id);
            totalCommentsScraped += comments.length;
            
            // Add post context to comments
            comments.forEach(c => {
                c.postId = post.id;
                c.postTitle = post.title;
                c.subreddit = subreddit;
                allComments.push(c);
            });
            
            await sleep(DELAY_BETWEEN_REQUESTS);
        }

        await sleep(DELAY_BETWEEN_SUBREDDITS);
    }

    console.log(`  Fetched ${totalPostsScraped} posts and ${totalCommentsScraped} comments`);

    // Phase 2: Use AI to extract movie titles from batched texts
    console.log('  Extracting movies with AI...');
    
    const batches = batchTextsForAI(allPosts, allComments);
    console.log(`  Processing ${batches.length} batches...`);
    
    const allMentions = new Map();
    let batchNum = 0;
    
    for (const batch of batches) {
        batchNum++;
        const movies = await extractMoviesWithAI(batch);
        
        // Calculate average score for this batch
        const avgScore = batch.reduce((sum, t) => sum + (t.score || 1), 0) / batch.length;
        const postInfo = batch[0]; // Use first item's post info
        
        for (const movie of movies) {
            const key = movie.title.toLowerCase().trim();
            
            if (allMentions.has(key)) {
                const existing = allMentions.get(key);
                existing.count++;
                existing.totalScore += avgScore;
                // Keep the most positive sentiment
                if (movie.sentiment === 'positive') {
                    existing.sentiment = 'positive';
                }
            } else {
                allMentions.set(key, {
                    title: movie.title,
                    year: movie.year,
                    sentiment: movie.sentiment || 'neutral',
                    subreddit: postInfo.subreddit || 'unknown',
                    postId: postInfo.postId || 'unknown',
                    postTitle: postInfo.postTitle || '',
                    count: 1,
                    totalScore: avgScore,
                });
            }
        }
        
        // Progress indicator
        if (batchNum % 5 === 0 || batchNum === batches.length) {
            console.log(`    Batch ${batchNum}/${batches.length} - Found ${allMentions.size} unique movies so far`);
        }
        
        await sleep(3500); // 3.5 seconds between calls (free tier: 20 req/min)
    }

    console.log(`  AI extracted ${allMentions.size} unique movie/show titles`);

    // Phase 3: Validate against TMDB
    const recommendations = [];
    const sortedMentions = Array.from(allMentions.entries())
        .sort((a, b) => (b[1].count * b[1].totalScore) - (a[1].count * a[1].totalScore))
        .slice(0, 150);

    console.log(`  Validating ${sortedMentions.length} titles against TMDB...`);
    let checkedCount = 0;
    let matchedCount = 0;
    
    for (const [_key, data] of sortedMentions) {
        checkedCount++;
        const tmdbResult = await searchTMDB(data.title, data.year);
        
        if (tmdbResult) {
            matchedCount++;
            recommendations.push({
                id: generateId(15),
                title: data.title,
                tmdbId: tmdbResult.tmdbId,
                mediaType: tmdbResult.mediaType,
                subreddit: data.subreddit,
                postId: data.postId,
                postTitle: data.postTitle,
                mentionCount: data.count,
                totalScore: Math.round(data.totalScore),
                sentiment: data.sentiment,
                genres: [],
            });
        }

        if (checkedCount % 25 === 0) {
            console.log(`    Checked ${checkedCount}/${sortedMentions.length}, found ${matchedCount} valid...`);
        }

        await sleep(200);
    }

    console.log(`  Validated ${matchedCount}/${sortedMentions.length} as real movies/shows`);

    return recommendations;
}

// ============================================================================
// DATABASE OPERATIONS
// ============================================================================

async function saveToDatabase(recommendations) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        console.error('DATABASE_URL is not defined');
        return 0;
    }

    const sql = neon(databaseUrl);
    let savedCount = 0;

    for (const rec of recommendations) {
        try {
            await sql`
                INSERT INTO reddit_recommendations (
                    id, title, tmdb_id, media_type, subreddit, post_id, post_title,
                    mention_count, total_score, sentiment, genres, scraped_at, updated_at
                ) VALUES (
                    ${rec.id}, ${rec.title}, ${rec.tmdbId}, ${rec.mediaType},
                    ${rec.subreddit}, ${rec.postId}, ${rec.postTitle},
                    ${rec.mentionCount}, ${rec.totalScore}, ${rec.sentiment},
                    ${JSON.stringify(rec.genres)}, NOW(), NOW()
                )
                ON CONFLICT (title) DO UPDATE SET
                    tmdb_id = COALESCE(EXCLUDED.tmdb_id, reddit_recommendations.tmdb_id),
                    mention_count = GREATEST(reddit_recommendations.mention_count, EXCLUDED.mention_count),
                    total_score = GREATEST(reddit_recommendations.total_score, EXCLUDED.total_score),
                    sentiment = EXCLUDED.sentiment,
                    genres = EXCLUDED.genres,
                    updated_at = NOW()
            `;
            savedCount++;
        } catch (error) {
            console.error(`  Error saving "${rec.title}":`, error.message);
        }
    }

    // Update scrape metadata (store subreddits hash in items_scraped for cache invalidation)
    try {
        const metaId = generateId(15);
        await sql`
            INSERT INTO scrape_metadata (id, scrape_type, last_scraped_at, items_scraped)
            VALUES (${metaId}, 'reddit_recommendations', NOW(), ${SUBREDDITS_HASH})
            ON CONFLICT (scrape_type) DO UPDATE SET
                last_scraped_at = NOW(),
                items_scraped = ${SUBREDDITS_HASH}
        `;
    } catch (error) {
        console.error('  Error updating scrape metadata:', error.message);
    }

    return savedCount;
}

// ============================================================================
// CACHE CHECK
// ============================================================================

/**
 * Check if the cache is still valid
 * Cache is invalidated if:
 * 1. No previous scrape exists
 * 2. Last scrape is older than CACHE_TTL_HOURS
 * 3. Subreddit list has changed since last scrape
 */
async function isCacheValid() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        return { valid: false, reason: 'No database URL' };
    }

    try {
        const sql = neon(databaseUrl);
        
        // items_scraped column stores the subreddits hash from last scrape
        const result = await sql`
            SELECT last_scraped_at, items_scraped 
            FROM scrape_metadata 
            WHERE scrape_type = 'reddit_recommendations'
        `;

        if (result.length === 0) {
            return { valid: false, reason: 'No previous scrape found' };
        }

        const lastScrapedAt = new Date(result[0].last_scraped_at);
        const lastSubredditsHash = result[0].items_scraped;
        const now = new Date();
        const hoursSinceLastScrape = (now - lastScrapedAt) / (1000 * 60 * 60);

        console.log(`  Last scraped: ${lastScrapedAt.toISOString()}`);
        console.log(`  Hours since last scrape: ${hoursSinceLastScrape.toFixed(1)}`);
        console.log(`  Cache TTL: ${CACHE_TTL_HOURS} hours (${(CACHE_TTL_HOURS / 24).toFixed(1)} days)`);
        
        // Check if subreddit list has changed
        if (lastSubredditsHash && lastSubredditsHash !== SUBREDDITS_HASH) {
            console.log(`  Previous subreddits: ${lastSubredditsHash}`);
            console.log(`  Current subreddits: ${SUBREDDITS_HASH}`);
            return { valid: false, reason: 'Subreddit list has changed' };
        }

        // Check if cache has expired
        if (hoursSinceLastScrape >= CACHE_TTL_HOURS) {
            return { valid: false, reason: `Cache expired (${hoursSinceLastScrape.toFixed(1)}h > ${CACHE_TTL_HOURS}h)` };
        }

        return { valid: true, reason: 'Cache is valid' };
    } catch (error) {
        console.error('  Error checking cache:', error.message);
        return { valid: false, reason: `Error: ${error.message}` };
    }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
    console.log('=== Reddit Recommendations Scraper ===\n');
    console.log('Configuration:');
    console.log(`  Subreddits: ${MOVIE_SUBREDDITS.join(', ')}`);
    console.log(`  Posts per subreddit: ${POSTS_PER_SUBREDDIT}`);
    console.log(`  Min score: ${MIN_SCORE}`);
    console.log(`  Timeframe: ${TIMEFRAME}`);
    console.log(`  Cache TTL: ${CACHE_TTL_HOURS} hours`);
    console.log(`  Force scrape: ${FORCE_SCRAPE}`);
    console.log('');

    // Check cache unless --force is used
    if (!FORCE_SCRAPE) {
        console.log('Checking cache...');
        const cacheStatus = await isCacheValid();
        
        if (cacheStatus.valid) {
            console.log('\n=== Skipping Scrape (Cache Valid) ===');
            console.log('  Use --force to bypass cache check');
            return;
        }
        console.log(`  Cache invalid: ${cacheStatus.reason}`);
        console.log('  Proceeding with scrape...\n');
    } else {
        console.log('Force scrape enabled, bypassing cache check\n');
    }
    
    const startTime = Date.now();
    
    try {
        const recommendations = await scrapeReddit();
        
        console.log('\n  Saving to database...');
        const savedCount = await saveToDatabase(recommendations);
        
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`\n=== Scrape Complete ===`);
        console.log(`  Saved: ${savedCount} recommendations`);
        console.log(`  Duration: ${duration}s`);
        
    } catch (error) {
        console.error('Scrape failed:', error);
        process.exit(1);
    }
}

main();
