import { sql } from '../lib/db.js';
import { generateId } from '../lib/utils.js';

// ============================================================================
// TYPES
// ============================================================================

export interface RedditPost {
    id: string;
    title: string;
    selftext: string;
    subreddit: string;
    score: number;
    numComments: number;
    url: string;
    createdUtc: number;
    author: string;
}

export interface RedditComment {
    id: string;
    body: string;
    score: number;
    author: string;
}

export interface RedditRecommendation {
    id: string;
    title: string;
    tmdbId: string | null;
    mediaType: 'movie' | 'tv';
    subreddit: string;
    postId: string;
    postTitle: string;
    mentionCount: number;
    totalScore: number; // Sum of upvotes from posts/comments mentioning this
    sentiment: 'positive' | 'neutral' | 'negative' | null;
    genres: string[]; // Extracted genre keywords from context
    scrapedAt: string;
    updatedAt: string;
}

export interface ExtractedMovieMention {
    title: string;
    year?: number;
    context: string; // The surrounding text for sentiment analysis
    score: number; // Upvote score of the post/comment
    genres: string[]; // Any genre keywords found in context
}

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Subreddits to scrape for movie/TV recommendations
 * 
 * Selection rationale:
 * - MovieSuggestions (~2M members): Primary recommendation sub, users explicitly ask for and give movie suggestions
 * - movies (~35M members): Large general movie discussion, lots of "what should I watch" threads  
 * - flicks (~150K members): Smaller but quality-focused movie discussion community
 * - TrueFilm (~1.5M members): More serious/analytical film discussion, good for finding hidden gems
 * - horror (~3M members): Genre-specific, great for horror recommendations
 * - scifi (~2M members): Genre-specific, good for sci-fi recommendations
 * - televisionsuggestions: TV show recommendations
 * 
 * Note: Actual scraping is done at build time via scripts/scrapeReddit.mjs
 * Configure via env vars: REDDIT_SUBREDDITS (comma-separated list)
 */
export const MOVIE_SUBREDDITS = [
    'MovieSuggestions',
    'movies',
    'flicks',
    'TrueFilm',
    'horror',
    'scifi',
    'televisionsuggestions',
];

// Common genre keywords to extract from posts
const GENRE_KEYWORDS = [
    'horror', 'comedy', 'drama', 'thriller', 'action', 'romance',
    'sci-fi', 'scifi', 'science fiction', 'fantasy', 'mystery',
    'documentary', 'animation', 'animated', 'western', 'musical',
    'crime', 'war', 'adventure', 'family', 'noir', 'psychological',
    'supernatural', 'slasher', 'indie', 'foreign', 'classic',
    'mind-bending', 'mindbending', 'feel-good', 'feelgood',
    'dark', 'disturbing', 'uplifting', 'emotional', 'slow-burn',
];

// Positive sentiment indicators
const POSITIVE_INDICATORS = [
    'amazing', 'incredible', 'masterpiece', 'loved', 'love', 'favorite',
    'best', 'highly recommend', 'must watch', 'must-watch', 'fantastic',
    'brilliant', 'excellent', 'perfect', 'great', 'awesome', 'underrated',
    'gem', 'hidden gem', 'beautiful', 'stunning', 'phenomenal', '10/10',
    'blew my mind', 'changed my life', 'can\'t recommend enough',
];

// Negative sentiment indicators
const NEGATIVE_INDICATORS = [
    'terrible', 'awful', 'worst', 'hated', 'boring', 'overrated',
    'disappointing', 'waste of time', 'don\'t watch', 'avoid',
    'bad', 'mediocre', 'skip', 'not worth', 'garbage', 'trash',
];

// ============================================================================
// REDDIT API HELPERS
// ============================================================================

/**
 * Fetch JSON data from Reddit by appending .json to URLs
 * Reddit's public JSON API doesn't require authentication for read-only access
 */
async function fetchRedditJson<T>(url: string): Promise<T | null> {
    try {
        // Add .json suffix if not present
        const jsonUrl = url.endsWith('.json') ? url : `${url}.json`;
        
        const response = await fetch(jsonUrl, {
            headers: {
                'User-Agent': 'MovieBuffs/1.0 (Movie recommendation aggregator)',
                'Accept': 'application/json',
            },
        });

        if (!response.ok) {
            if (response.status === 429) {
                console.warn('Reddit rate limit hit, waiting before retry...');
                await sleep(2000);
                return fetchRedditJson(url);
            }
            console.error(`Reddit API error: ${response.status} for ${url}`);
            return null;
        }

        return await response.json() as T;
    } catch (error) {
        console.error(`Error fetching Reddit data from ${url}:`, error);
        return null;
    }
}

/**
 * Sleep helper for rate limiting
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// POST SCRAPING
// ============================================================================

interface RedditListingResponse {
    kind: string;
    data: {
        children: Array<{
            kind: string;
            data: {
                id: string;
                title: string;
                selftext: string;
                subreddit: string;
                score: number;
                num_comments: number;
                url: string;
                created_utc: number;
                author: string;
                permalink: string;
            };
        }>;
        after: string | null;
    };
}

/**
 * Fetch top posts from a subreddit
 */
export async function fetchSubredditPosts(
    subreddit: string,
    timeframe: 'hour' | 'day' | 'week' | 'month' | 'year' | 'all' = 'week',
    limit: number = 25
): Promise<RedditPost[]> {
    const url = `https://www.reddit.com/r/${subreddit}/top.json?t=${timeframe}&limit=${limit}`;
    const response = await fetchRedditJson<RedditListingResponse>(url);

    if (!response?.data?.children) {
        return [];
    }

    return response.data.children.map(child => ({
        id: child.data.id,
        title: child.data.title,
        selftext: child.data.selftext,
        subreddit: child.data.subreddit,
        score: child.data.score,
        numComments: child.data.num_comments,
        url: `https://www.reddit.com${child.data.permalink}`,
        createdUtc: child.data.created_utc,
        author: child.data.author,
    }));
}

/**
 * Search subreddit for posts matching a query (genre, keyword, etc.)
 */
export async function searchSubreddit(
    subreddit: string,
    query: string,
    limit: number = 25
): Promise<RedditPost[]> {
    const encodedQuery = encodeURIComponent(query);
    const url = `https://www.reddit.com/r/${subreddit}/search.json?q=${encodedQuery}&restrict_sr=1&sort=relevance&t=year&limit=${limit}`;
    const response = await fetchRedditJson<RedditListingResponse>(url);

    if (!response?.data?.children) {
        return [];
    }

    return response.data.children.map(child => ({
        id: child.data.id,
        title: child.data.title,
        selftext: child.data.selftext,
        subreddit: child.data.subreddit,
        score: child.data.score,
        numComments: child.data.num_comments,
        url: `https://www.reddit.com${child.data.permalink}`,
        createdUtc: child.data.created_utc,
        author: child.data.author,
    }));
}

/**
 * Fetch comments from a post
 */
type RedditCommentsResponse = Array<{
    kind: string;
    data: {
        children: Array<{
            kind: string;
            data: {
                id: string;
                body?: string;
                score: number;
                author: string;
                replies?: RedditCommentsResponse[0];
            };
        }>;
    };
}>;

export async function fetchPostComments(
    subreddit: string,
    postId: string,
    limit: number = 100
): Promise<RedditComment[]> {
    const url = `https://www.reddit.com/r/${subreddit}/comments/${postId}.json?limit=${limit}&depth=2`;
    const response = await fetchRedditJson<RedditCommentsResponse>(url);

    if (!response || response.length < 2) {
        return [];
    }

    const comments: RedditComment[] = [];
    
    // Comments are in the second element of the response array
    const commentsData = response[1]?.data?.children || [];
    
    for (const child of commentsData) {
        if (child.kind === 't1' && child.data.body) {
            comments.push({
                id: child.data.id,
                body: child.data.body,
                score: child.data.score,
                author: child.data.author,
            });
        }
    }

    return comments;
}

// ============================================================================
// MOVIE EXTRACTION
// ============================================================================

/**
 * Common patterns for movie mentions in Reddit posts
 * - "Movie Title (Year)"
 * - "**Movie Title**"
 * - "Movie Title - description"
 */
const MOVIE_PATTERNS = [
    // Pattern: "Movie Title (2023)" or "Movie Title (2023)"
    /[""]?([A-Z][^""()\n]{2,50}?)\s*\((\d{4})\)/g,
    // Pattern: **Movie Title** (markdown bold)
    /\*\*([A-Z][^*\n]{2,50}?)\*\*/g,
    // Pattern: "Movie Title" (quoted)
    /[""]([A-Z][^""]{2,50}?)[""]/g,
];

// Words that are likely NOT movie titles
const FALSE_POSITIVE_WORDS = [
    'edit', 'update', 'spoiler', 'spoilers', 'warning', 'request', 'suggest',
    'suggestion', 'looking for', 'anyone', 'everyone', 'someone', 'nobody',
    'help', 'please', 'thanks', 'thank you', 'imdb', 'rotten tomatoes',
    'netflix', 'hulu', 'amazon', 'disney', 'hbo', 'youtube', 'reddit',
    'comment', 'post', 'thread', 'question', 'answer', 'reply',
];

/**
 * Extract movie mentions from text
 */
export function extractMovieMentions(text: string, baseScore: number = 1): ExtractedMovieMention[] {
    const mentions: ExtractedMovieMention[] = [];
    const seenTitles = new Set<string>();

    for (const pattern of MOVIE_PATTERNS) {
        // Reset regex state
        pattern.lastIndex = 0;
        
        let match;
        while ((match = pattern.exec(text)) !== null) {
            const title = match[1].trim();
            const year = match[2] ? parseInt(match[2], 10) : undefined;
            
            // Skip false positives
            const lowerTitle = title.toLowerCase();
            if (FALSE_POSITIVE_WORDS.some(word => lowerTitle === word || lowerTitle.startsWith(word + ' '))) {
                continue;
            }
            
            // Skip if too short or already seen
            if (title.length < 2 || seenTitles.has(lowerTitle)) {
                continue;
            }
            
            seenTitles.add(lowerTitle);
            
            // Get surrounding context (100 chars before and after)
            const startIndex = Math.max(0, match.index - 100);
            const endIndex = Math.min(text.length, match.index + match[0].length + 100);
            const context = text.substring(startIndex, endIndex);
            
            // Extract genres from context
            const genres = extractGenresFromText(context);
            
            mentions.push({
                title,
                year,
                context,
                score: baseScore,
                genres,
            });
        }
    }

    return mentions;
}

/**
 * Extract genre keywords from text
 */
function extractGenresFromText(text: string): string[] {
    const lowerText = text.toLowerCase();
    const genres: string[] = [];
    
    for (const genre of GENRE_KEYWORDS) {
        if (lowerText.includes(genre)) {
            // Normalize some variations
            const normalized = genre
                .replace('sci-fi', 'science fiction')
                .replace('scifi', 'science fiction')
                .replace('mindbending', 'mind-bending')
                .replace('feelgood', 'feel-good');
            
            if (!genres.includes(normalized)) {
                genres.push(normalized);
            }
        }
    }
    
    return genres;
}

/**
 * Analyze sentiment of text about a movie
 */
export function analyzeSentiment(text: string): 'positive' | 'neutral' | 'negative' {
    const lowerText = text.toLowerCase();
    
    let positiveCount = 0;
    let negativeCount = 0;
    
    for (const indicator of POSITIVE_INDICATORS) {
        if (lowerText.includes(indicator)) {
            positiveCount++;
        }
    }
    
    for (const indicator of NEGATIVE_INDICATORS) {
        if (lowerText.includes(indicator)) {
            negativeCount++;
        }
    }
    
    if (positiveCount > negativeCount && positiveCount >= 1) {
        return 'positive';
    } else if (negativeCount > positiveCount && negativeCount >= 1) {
        return 'negative';
    }
    
    return 'neutral';
}

// ============================================================================
// TMDB INTEGRATION
// ============================================================================

interface TMDBSearchResult {
    results: Array<{
        id: number;
        title?: string;
        name?: string;
        release_date?: string;
        first_air_date?: string;
        media_type?: string;
    }>;
}

/**
 * Search TMDB for a movie/TV show by title
 * Returns the TMDB ID if found
 */
export async function searchTMDB(
    title: string,
    year?: number,
    mediaType: 'movie' | 'tv' = 'movie'
): Promise<{ tmdbId: string; mediaType: 'movie' | 'tv' } | null> {
    const TMDB_API_KEY = process.env.TMDB_API_KEY;
    const TMDB_BASE_URL = process.env.TMDB_BASE_URL;

    if (!TMDB_API_KEY || !TMDB_BASE_URL) {
        console.error('TMDB API key or base URL not configured');
        return null;
    }

    try {
        // First try specific media type search
        let url = new URL(`${TMDB_BASE_URL}/search/${mediaType}`);
        url.searchParams.append('api_key', TMDB_API_KEY);
        url.searchParams.append('query', title);
        if (year) {
            url.searchParams.append(mediaType === 'movie' ? 'year' : 'first_air_date_year', year.toString());
        }

        let response = await fetch(url.toString());
        if (response.ok) {
            const data = await response.json() as TMDBSearchResult;
            if (data.results && data.results.length > 0) {
                return {
                    tmdbId: data.results[0].id.toString(),
                    mediaType,
                };
            }
        }

        // If movie search fails, try TV
        if (mediaType === 'movie') {
            url = new URL(`${TMDB_BASE_URL}/search/tv`);
            url.searchParams.append('api_key', TMDB_API_KEY);
            url.searchParams.append('query', title);
            if (year) {
                url.searchParams.append('first_air_date_year', year.toString());
            }

            response = await fetch(url.toString());
            if (response.ok) {
                const data = await response.json() as TMDBSearchResult;
                if (data.results && data.results.length > 0) {
                    return {
                        tmdbId: data.results[0].id.toString(),
                        mediaType: 'tv',
                    };
                }
            }
        }

        return null;
    } catch (error) {
        console.error(`Error searching TMDB for "${title}":`, error);
        return null;
    }
}

// ============================================================================
// MAIN SCRAPING FUNCTION
// ============================================================================

export interface ScrapeOptions {
    subreddits?: string[];
    timeframe?: 'hour' | 'day' | 'week' | 'month' | 'year' | 'all';
    postsPerSubreddit?: number;
    includeComments?: boolean;
    genres?: string[]; // Filter by genre keywords
    minScore?: number; // Minimum upvote score
}

export interface ScrapeResult {
    totalPostsScraped: number;
    totalMentionsFound: number;
    recommendationsMatched: number;
    recommendations: RedditRecommendation[];
}

/**
 * Main function to scrape Reddit for movie recommendations
 */
export async function scrapeRedditForRecommendations(
    options: ScrapeOptions = {}
): Promise<ScrapeResult> {
    const {
        subreddits = MOVIE_SUBREDDITS,
        timeframe = 'week',
        postsPerSubreddit = 25,
        includeComments = true,
        genres = [],
        minScore = 10,
    } = options;

    const allMentions: Map<string, {
        mention: ExtractedMovieMention;
        subreddit: string;
        postId: string;
        postTitle: string;
        count: number;
        totalScore: number;
        allGenres: Set<string>;
        contexts: string[];
    }> = new Map();

    let totalPostsScraped = 0;
    let totalMentionsFound = 0;

    for (const subreddit of subreddits) {
        console.log(`Scraping r/${subreddit}...`);
        
        let posts: RedditPost[] = [];
        
        // If genres specified, search for those; otherwise get top posts
        if (genres.length > 0) {
            for (const genre of genres) {
                const searchPosts = await searchSubreddit(subreddit, genre, Math.ceil(postsPerSubreddit / genres.length));
                posts.push(...searchPosts);
                await sleep(500); // Rate limiting
            }
        } else {
            posts = await fetchSubredditPosts(subreddit, timeframe, postsPerSubreddit);
        }

        // Filter by minimum score
        posts = posts.filter(p => p.score >= minScore);
        totalPostsScraped += posts.length;

        for (const post of posts) {
            // Extract mentions from post title and body
            const titleMentions = extractMovieMentions(post.title, post.score);
            const bodyMentions = extractMovieMentions(post.selftext, post.score);
            const postMentions = [...titleMentions, ...bodyMentions];
            
            // If comments enabled, also extract from top comments
            if (includeComments && post.numComments > 0) {
                const comments = await fetchPostComments(subreddit, post.id, 50);
                for (const comment of comments.filter(c => c.score >= 5)) {
                    const commentMentions = extractMovieMentions(comment.body, comment.score);
                    postMentions.push(...commentMentions);
                }
                await sleep(300); // Rate limiting
            }

            // Aggregate mentions
            for (const mention of postMentions) {
                const key = mention.title.toLowerCase();
                
                if (allMentions.has(key)) {
                    const existing = allMentions.get(key)!;
                    existing.count++;
                    existing.totalScore += mention.score;
                    existing.contexts.push(mention.context);
                    mention.genres.forEach(g => existing.allGenres.add(g));
                } else {
                    allMentions.set(key, {
                        mention,
                        subreddit,
                        postId: post.id,
                        postTitle: post.title,
                        count: 1,
                        totalScore: mention.score,
                        allGenres: new Set(mention.genres),
                        contexts: [mention.context],
                    });
                }
                
                totalMentionsFound++;
            }
        }

        await sleep(1000); // Rate limiting between subreddits
    }

    // Match mentions to TMDB and create recommendations
    const recommendations: RedditRecommendation[] = [];
    let recommendationsMatched = 0;

    // Sort by count * score (most mentioned + upvoted first)
    const sortedMentions = Array.from(allMentions.entries())
        .sort((a, b) => (b[1].count * b[1].totalScore) - (a[1].count * a[1].totalScore))
        .slice(0, 100); // Limit to top 100 to avoid too many TMDB calls

    for (const [_key, data] of sortedMentions) {
        // Search TMDB for this title
        const tmdbResult = await searchTMDB(data.mention.title, data.mention.year);
        
        // Analyze overall sentiment from all contexts
        const combinedContext = data.contexts.join(' ');
        const sentiment = analyzeSentiment(combinedContext);

        const recommendation: RedditRecommendation = {
            id: generateId(15),
            title: data.mention.title,
            tmdbId: tmdbResult?.tmdbId || null,
            mediaType: tmdbResult?.mediaType || 'movie',
            subreddit: data.subreddit,
            postId: data.postId,
            postTitle: data.postTitle,
            mentionCount: data.count,
            totalScore: data.totalScore,
            sentiment,
            genres: Array.from(data.allGenres),
            scrapedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        recommendations.push(recommendation);
        
        if (tmdbResult) {
            recommendationsMatched++;
        }

        await sleep(200); // Rate limiting for TMDB
    }

    return {
        totalPostsScraped,
        totalMentionsFound,
        recommendationsMatched,
        recommendations,
    };
}

// ============================================================================
// DATABASE OPERATIONS
// ============================================================================

/**
 * Save Reddit recommendations to database
 */
export async function saveRedditRecommendations(
    recommendations: RedditRecommendation[]
): Promise<number> {
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
                    ${JSON.stringify(rec.genres)}, ${rec.scrapedAt}, ${rec.updatedAt}
                )
                ON CONFLICT (title) DO UPDATE SET
                    tmdb_id = COALESCE(EXCLUDED.tmdb_id, reddit_recommendations.tmdb_id),
                    mention_count = reddit_recommendations.mention_count + EXCLUDED.mention_count,
                    total_score = reddit_recommendations.total_score + EXCLUDED.total_score,
                    sentiment = EXCLUDED.sentiment,
                    genres = EXCLUDED.genres,
                    updated_at = EXCLUDED.updated_at
            `;
            savedCount++;
        } catch (error) {
            console.error(`Error saving recommendation for "${rec.title}":`, error);
        }
    }

    return savedCount;
}

/**
 * Get Reddit recommendations from database
 */
export async function getRedditRecommendations(options: {
    genres?: string[];
    minMentions?: number;
    minScore?: number;
    sentiment?: 'positive' | 'neutral' | 'negative';
    limit?: number;
    onlyWithTmdb?: boolean;
}): Promise<RedditRecommendation[]> {
    const {
        genres = [],
        minMentions = 1,
        minScore = 0,
        sentiment,
        limit = 50,
        onlyWithTmdb = true,
    } = options;

    try {
        // Query reddit recommendations with filters
        const query = sql`
            SELECT 
                id, title, tmdb_id as "tmdbId", media_type as "mediaType",
                subreddit, post_id as "postId", post_title as "postTitle",
                mention_count as "mentionCount", 
                total_score as "totalScore",
                sentiment, genres, scraped_at as "scrapedAt", updated_at as "updatedAt"
            FROM reddit_recommendations
            WHERE mention_count >= ${minMentions}
              AND total_score >= ${minScore}
              ${onlyWithTmdb ? sql`AND tmdb_id IS NOT NULL` : sql``}
              ${sentiment ? sql`AND sentiment = ${sentiment}` : sql``}
            ORDER BY (mention_count * total_score) DESC
            LIMIT ${limit}
        `;

        const results = await query;

        // Filter by genres in application layer (JSON array querying)
        let filtered = results.map((row: Record<string, unknown>) => ({
            ...row,
            genres: typeof row.genres === 'string' ? JSON.parse(row.genres) : (row.genres || []),
        })) as RedditRecommendation[];

        if (genres.length > 0) {
            filtered = filtered.filter(rec =>
                genres.some(g => rec.genres.includes(g.toLowerCase()))
            );
        }

        return filtered;
    } catch (error) {
        console.error('Error fetching Reddit recommendations:', error);
        return [];
    }
}

/**
 * Get the last scrape metadata for Reddit
 */
export async function getRedditScrapeMetadata(): Promise<{
    lastScrapedAt: string | null;
    totalRecommendations: number;
} | null> {
    try {
        const metadata = await sql`
            SELECT last_scraped_at as "lastScrapedAt"
            FROM scrape_metadata
            WHERE scrape_type = 'reddit_recommendations'
        `;

        const count = await sql`
            SELECT COUNT(*) as count FROM reddit_recommendations
        `;

        return {
            lastScrapedAt: metadata[0]?.lastScrapedAt || null,
            totalRecommendations: parseInt(count[0]?.count || '0', 10),
        };
    } catch (error) {
        console.error('Error fetching Reddit scrape metadata:', error);
        return null;
    }
}

/**
 * Update Reddit scrape metadata
 */
export async function updateRedditScrapeMetadata(): Promise<boolean> {
    try {
        const id = generateId(15);
        await sql`
            INSERT INTO scrape_metadata (id, scrape_type, last_scraped_at)
            VALUES (${id}, 'reddit_recommendations', NOW())
            ON CONFLICT (scrape_type) DO UPDATE SET
                last_scraped_at = NOW()
        `;
        return true;
    } catch (error) {
        console.error('Error updating Reddit scrape metadata:', error);
        return false;
    }
}

/**
 * Check if a Reddit scrape is needed (more than 1 day since last scrape)
 */
export async function isRedditScrapeNeeded(): Promise<boolean> {
    const metadata = await getRedditScrapeMetadata();
    
    if (!metadata?.lastScrapedAt) {
        return true;
    }
    
    const lastScraped = new Date(metadata.lastScrapedAt);
    const now = new Date();
    const hoursSinceLastScrape = (now.getTime() - lastScraped.getTime()) / (1000 * 60 * 60);
    
    // Scrape if more than 24 hours since last scrape
    return hoursSinceLastScrape >= 24;
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Get movie recommendations by genre from Reddit
 */
export async function getRedditRecommendationsByGenre(
    genre: string,
    limit: number = 20
): Promise<RedditRecommendation[]> {
    return getRedditRecommendations({
        genres: [genre],
        minMentions: 2,
        sentiment: 'positive',
        limit,
        onlyWithTmdb: true,
    });
}

/**
 * Scrape and save recommendations (full pipeline)
 */
export async function refreshRedditRecommendations(
    options: ScrapeOptions = {}
): Promise<ScrapeResult> {
    console.log('Starting Reddit recommendations scrape...');
    
    const result = await scrapeRedditForRecommendations(options);
    
    console.log(`Scraped ${result.totalPostsScraped} posts, found ${result.totalMentionsFound} mentions`);
    console.log(`Matched ${result.recommendationsMatched} to TMDB`);
    
    if (result.recommendations.length > 0) {
        const savedCount = await saveRedditRecommendations(result.recommendations);
        console.log(`Saved ${savedCount} recommendations to database`);
        
        await updateRedditScrapeMetadata();
    }
    
    return result;
}
