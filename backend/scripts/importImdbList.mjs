/**
 * Import an IMDb list (CSV export) into the reddit_recommendations table.
 *
 * Accepts the CSV format exported from IMDb Lists / Watchlists. The CSV has an
 * IMDb "Const" column (e.g. tt0054215) which we resolve to a TMDB ID via TMDB's
 * /find/{imdb_id}?external_source=imdb_id endpoint, then upsert into
 * reddit_recommendations so the recommendation engine picks them up as Reddit boosts.
 *
 * Usage:
 *   node scripts/importImdbList.mjs --csv=/path/to/imdb-export.csv
 *   node scripts/importImdbList.mjs --csv=... --mentions=3 --score=100 --sentiment=positive
 *   node scripts/importImdbList.mjs --csv=... --dry-run        # resolve only, no DB writes
 *   node scripts/importImdbList.mjs --csv=... --limit=50       # only import first 50 rows
 *   node scripts/importImdbList.mjs --csv=... --types=movie,tv # filter by Title Type
 *
 * Env (loaded from backend/.env):
 *   TMDB_API_KEY   - required, for /find lookups
 *   TMDB_BASE_URL  - optional, defaults to https://api.themoviedb.org/3
 *   DATABASE_URL   - required unless --dry-run
 */

import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load backend/.env first (where TMDB_API_KEY / DATABASE_URL live), then cwd .env as fallback.
dotenv.config({ path: resolve(__dirname, '../.env') });
dotenv.config();

// ============================================================================
// CONFIGURATION
// ============================================================================

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE_URL = process.env.TMDB_BASE_URL || 'https://api.themoviedb.org/3';
const DATABASE_URL = process.env.DATABASE_URL;

const TMDB_RPS = 10;            // TMDB requests/sec cap
const TMDB_CONCURRENCY = 5;     // parallel /find workers
const TMDB_TIMEOUT_MS = 10000;  // per-request timeout
const TMDB_MAX_RETRIES = 2;     // retries for 429/5xx

function parseArgs(argv) {
    // These three values control how strongly the recommendation engine favors
    // imported items. See RECOMMENDATION_SYSTEM.md → "Reddit Integration" for
    // the exact formulas; summary below:
    //
    // mentions (mention_count):
    //   - Governs whether an item qualifies as a "Reddit primary candidate"
    //     (getRedditPrimaryCandidates requires minMentions >= 2).
    //   - Boost applied to ALL candidates: mentions * 30, capped at 200
    //     (REDDIT_BOOST_MULTIPLIER = 30, REDDIT_BOOST_MAX = 200).
    //   - Higher mentions → higher reddit_boost → larger CTR contribution
    //     (redditNorm = reddit_boost / 100 in the multi-objective ranker).
    //
    // score (total_score):
    //   - Secondary popularity signal. getRedditPrimaryCandidates filters on
    //     minScore >= 50, so values below 50 will NOT be injected as primary
    //     candidates (they can still receive a signal boost if already in the
    //     TMDB-sourced pool).
    //   - Used to rank Reddit recommendations when multiple mention the same
    //     title: ORDER BY (mention_count * total_score) DESC.
    //
    // sentiment:
    //   - 'positive' adds +20 to the boost (REDDIT_POSITIVE_SENTIMENT_BONUS).
    //   - 'negative'/'neutral' add nothing. Use 'positive' for curated lists
    //     (the items are implicitly endorsed by being on the list).
    const args = {
        csv: null,
        subreddit: 'curated',
        mentions: 3,
        score: 100,
        sentiment: 'positive',
        types: ['movie'],
        limit: 0,        // 0 = no limit
        dryRun: false,
        force: false,
    };

    for (const arg of argv.slice(2)) {
        if (arg.startsWith('--csv=')) args.csv = arg.slice(6);
        else if (arg.startsWith('--subreddit=')) args.subreddit = arg.slice(12);
        else if (arg.startsWith('--mentions=')) args.mentions = parseInt(arg.slice(11), 10);
        else if (arg.startsWith('--score=')) args.score = parseInt(arg.slice(8), 10);
        else if (arg.startsWith('--sentiment=')) args.sentiment = arg.slice(12);
        else if (arg.startsWith('--types=')) args.types = arg.slice(8).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        else if (arg.startsWith('--limit=')) args.limit = parseInt(arg.slice(8), 10);
        else if (arg === '--dry-run') args.dryRun = true;
        else if (arg === '--force') args.force = true;
        else if (arg === '-h' || arg === '--help') {
            console.log(`Usage: node scripts/importImdbList.mjs --csv=<path> [options]

Options:
  --csv=<path>         Path to IMDb CSV export (required)
  --subreddit=<name>   subreddit value to store (default: curated)
  --mentions=<n>       Reddit mention_count. Must be >=2 to qualify as a
                       "Reddit primary candidate" injected directly into the
                       pool. Adds mentions*30 to the boost (capped at 200).
                       (default: 3)
  --score=<n>          Reddit total_score (upvote sum). Must be >=50 to
                       qualify as a primary candidate; otherwise the item only
                       gets a signal boost if already TMDB-sourced. Used to
                       rank candidates via mention_count * total_score.
                       (default: 100)
  --sentiment=<s>      positive|neutral|negative. 'positive' adds +20 to the
                       boost; others add nothing. Use 'positive' for curated
                       lists (implicit endorsement). (default: positive)
  --types=<list>       Comma-separated Title Types to include (default: movie)
  --limit=<n>          Only import first n matching rows (default: 0 = all)
  --dry-run            Resolve TMDB IDs but do not write to the database
  --force              Skip the "already imported" guard
  -h, --help           Show this help`);
            process.exit(0);
        }
    }

    return args;
}

// ============================================================================
// HELPERS
// ============================================================================

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function generateId(length = 15) {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return result;
}

let tmdbNextAvailableAt = 0;

async function waitForTMDBSlot() {
    const minIntervalMs = 1000 / TMDB_RPS;
    const now = Date.now();
    const waitMs = Math.max(0, tmdbNextAvailableAt - now);
    tmdbNextAvailableAt = Math.max(tmdbNextAvailableAt, now) + minIntervalMs;
    if (waitMs > 0) await sleep(waitMs);
}

function getRetryDelayMs(attempt, retryAfterHeader = null) {
    const retryAfterSeconds = Number(retryAfterHeader);
    if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
        return retryAfterSeconds * 1000;
    }
    const base = 400;
    const jitter = Math.floor(Math.random() * 300);
    return (base * Math.pow(2, attempt)) + jitter;
}

async function fetchTMDBJson(url) {
    for (let attempt = 0; attempt <= TMDB_MAX_RETRIES; attempt++) {
        await waitForTMDBSlot();

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), TMDB_TIMEOUT_MS);

        try {
            const response = await fetch(url, { signal: controller.signal });

            if (response.status === 429 && attempt < TMDB_MAX_RETRIES) {
                const delayMs = getRetryDelayMs(attempt, response.headers.get('retry-after'));
                await sleep(delayMs);
                continue;
            }

            if (!response.ok) {
                if (response.status >= 500 && attempt < TMDB_MAX_RETRIES) {
                    await sleep(getRetryDelayMs(attempt));
                    continue;
                }
                console.error(`  TMDB HTTP ${response.status} for ${url}`);
                return null;
            }

            return await response.json();
        } catch (error) {
            if (attempt < TMDB_MAX_RETRIES) {
                await sleep(getRetryDelayMs(attempt));
                continue;
            }
            console.error(`  TMDB fetch error for ${url}:`, error.message);
            return null;
        } finally {
            clearTimeout(timeoutId);
        }
    }
    return null;
}

// ============================================================================
// CSV PARSING (RFC 4180: quoted fields, embedded commas/quotes)
// ============================================================================

function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];

        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') {
                    field += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                field += ch;
            }
            continue;
        }

        if (ch === '"') {
            inQuotes = true;
        } else if (ch === ',') {
            row.push(field);
            field = '';
        } else if (ch === '\n') {
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
        } else if (ch === '\r') {
            // Ignore - handled by \n
        } else {
            field += ch;
        }
    }

    // Last field/row if file doesn't end with newline
    if (field.length > 0 || row.length > 0) {
        row.push(field);
        rows.push(row);
    }

    return rows;
}

function parseCsvFile(filePath) {
    const absolute = resolve(filePath);
    const text = readFileSync(absolute, 'utf8');
    // Strip BOM if present
    const clean = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
    const rows = parseCsv(clean);
    if (rows.length === 0) return { headers: [], records: [] };

    const headers = rows[0].map(h => h.trim());
    const records = rows.slice(1).map(row => {
        const obj = {};
        for (let i = 0; i < headers.length; i++) {
            obj[headers[i]] = (row[i] ?? '').trim();
        }
        return obj;
    });

    return { headers, records };
}

// ============================================================================
// TMDB LOOKUP via /find/{imdb_id}
// ============================================================================

/**
 * Resolve an IMDb ID to a TMDB ID + canonical title/year/mediaType.
 * Returns null if not found.
 */
async function findTmdbByImdbId(imdbId) {
    if (!TMDB_API_KEY) {
        console.error('TMDB_API_KEY is not set');
        return null;
    }

    const url = new URL(`${TMDB_BASE_URL}/find/${imdbId}`);
    url.searchParams.append('api_key', TMDB_API_KEY);
    url.searchParams.append('external_source', 'imdb_id');
    url.searchParams.append('language', 'en-US');

    const data = await fetchTMDBJson(url.toString());
    if (!data) return null;

    // Prefer movie results, then tv results
    const movieResults = data.movie_results || [];
    const tvResults = data.tv_results || [];
    const tvEpisodeResults = data.tv_episode_results || [];
    const tvSeasonResults = data.tv_season_results || [];

    if (movieResults.length > 0) {
        const best = movieResults[0];
        return {
            tmdbId: best.id.toString(),
            mediaType: 'movie',
            canonicalTitle: best.title || best.name || null,
            canonicalYear: parseInt((best.release_date || '').slice(0, 4), 10) || null,
        };
    }

    if (tvResults.length > 0) {
        const best = tvResults[0];
        return {
            tmdbId: best.id.toString(),
            mediaType: 'tv',
            canonicalTitle: best.name || best.title || null,
            canonicalYear: parseInt((best.first_air_date || '').slice(0, 4), 10) || null,
        };
    }

    // Skip episodes/seasons - not recommendation-eligible on their own
    if (tvEpisodeResults.length > 0 || tvSeasonResults.length > 0) {
        return { skip: true, reason: 'TV episode/season (not a standalone title)' };
    }

    return null;
}

// ============================================================================
// DATABASE OPERATIONS
// ============================================================================

async function saveToDatabase(recommendations) {
    if (!DATABASE_URL) {
        console.error('DATABASE_URL is not defined');
        return 0;
    }

    const sql = neon(DATABASE_URL);
    let savedCount = 0;
    let updatedCount = 0;

    for (const rec of recommendations) {
        try {
            // Upsert semantics for curated imports:
            //   mention_count / total_score: GREATEST — curated only lifts items
            //     up to its threshold; it never lowers organic signals or inflates
            //     on re-runs (idempotent). Matches the build-time scraper.
            //   sentiment / genres: COALESCE/CASE — only fill gaps. We never
            //     clobber an organic sentiment/genre from a real Reddit scrape,
            //     since the curated list has no real per-movie sentiment signal.
            //   title: always overwritten (TMDB canonical title is authoritative).
            //   release_year: only fills if existing is null.
            const result = await sql`
                INSERT INTO reddit_recommendations (
                    id, title, tmdb_id, release_year, media_type, subreddit, post_id, post_title,
                    mention_count, total_score, sentiment, genres, scraped_at, updated_at
                ) VALUES (
                    ${rec.id}, ${rec.title}, ${rec.tmdbId}, ${rec.releaseYear ?? null}, ${rec.mediaType},
                    ${rec.subreddit}, ${rec.postId}, ${rec.postTitle},
                    ${rec.mentionCount}, ${rec.totalScore}, ${rec.sentiment},
                    ${JSON.stringify(rec.genres)}, NOW(), NOW()
                )
                ON CONFLICT (tmdb_id) WHERE tmdb_id IS NOT NULL DO UPDATE SET
                    title = EXCLUDED.title,
                    release_year = COALESCE(EXCLUDED.release_year, reddit_recommendations.release_year),
                    mention_count = GREATEST(reddit_recommendations.mention_count, EXCLUDED.mention_count),
                    total_score = GREATEST(reddit_recommendations.total_score, EXCLUDED.total_score),
                    sentiment = COALESCE(reddit_recommendations.sentiment, EXCLUDED.sentiment),
                    genres = CASE
                        WHEN reddit_recommendations.genres IS NULL
                          OR reddit_recommendations.genres = '[]'
                          OR reddit_recommendations.genres = 'null'
                        THEN EXCLUDED.genres
                        ELSE reddit_recommendations.genres
                    END,
                    updated_at = NOW()
                RETURNING (xmax = 0) AS inserted
            `;
            if (result[0]?.inserted) {
                savedCount++;
            } else {
                updatedCount++;
            }
        } catch (error) {
            console.error(`  Error saving "${rec.title}" (tmdb ${rec.tmdbId}):`, error.message);
        }
    }

    console.log(`  Inserted: ${savedCount} new, updated: ${updatedCount} existing`);
    return savedCount + updatedCount;
}

async function countAlreadyImported(subreddit) {
    if (!DATABASE_URL) return 0;
    const sql = neon(DATABASE_URL);
    try {
        const result = await sql`
            SELECT COUNT(*)::int AS count
            FROM reddit_recommendations
            WHERE subreddit = ${subreddit}
        `;
        return result[0]?.count || 0;
    } catch (error) {
        console.error('  Error checking existing imports:', error.message);
        return 0;
    }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
    const args = parseArgs(process.argv);

    console.log('=== Import IMDb List ===\n');

    if (!args.csv) {
        console.error('Error: --csv=<path> is required. Use --help for usage.');
        process.exit(1);
    }

    console.log('Configuration:');
    console.log(`  CSV:         ${args.csv}`);
    console.log(`  Subreddit:   ${args.subreddit}`);
    console.log(`  Mentions:    ${args.mentions}`);
    console.log(`  Score:       ${args.score}`);
    console.log(`  Sentiment:   ${args.sentiment}`);
    console.log(`  Title types: ${args.types.join(', ')}`);
    console.log(`  Limit:       ${args.limit || 'all'}`);
    console.log(`  Dry run:     ${args.dryRun}`);
    console.log(`  TMDB RPS:    ${TMDB_RPS}, concurrency: ${TMDB_CONCURRENCY}`);
    console.log('');

    if (!TMDB_API_KEY) {
        console.error('Error: TMDB_API_KEY is not set. Add it to backend/.env');
        process.exit(1);
    }

    if (!args.dryRun && !DATABASE_URL) {
        console.error('Error: DATABASE_URL is not set. Add it to backend/.env (or use --dry-run)');
        process.exit(1);
    }

    // Guard: warn if already imported without --force
    if (!args.dryRun && !args.force) {
        const existing = await countAlreadyImported(args.subreddit);
        if (existing > 0) {
            console.log(`Found ${existing} rows already tagged subreddit='${args.subreddit}'.`);
            console.log('Use --force to run anyway (mention_count/total_score will be max-merged on conflicts).');
            return;
        }
    }

    // 1. Parse CSV
    console.log('Parsing CSV...');
    const { headers, records } = parseCsvFile(args.csv);
    if (!headers.includes('Const') || !headers.includes('Title')) {
        console.error(`CSV is missing required columns. Found headers: ${headers.join(', ')}`);
        console.error('Expected an IMDb export with at least: Const, Title, Title Type');
        process.exit(1);
    }

    console.log(`  Headers: ${headers.join(', ')}`);
    console.log(`  Total rows: ${records.length}`);

    // 2. Filter by Title Type and presence of Const
    const wanted = new Set(args.types.map(t => t.toLowerCase()));
    let filtered = records.filter(r => {
        const type = (r['Title Type'] || '').toLowerCase();
        const imdbId = (r['Const'] || '').trim();
        return imdbId.startsWith('tt') && (wanted.size === 0 || wanted.has(type));
    });

    console.log(`  After Title Type filter (${args.types.join(', ')}): ${filtered.length} rows`);

    if (args.limit > 0) {
        filtered = filtered.slice(0, args.limit);
        console.log(`  After --limit=${args.limit}: ${filtered.length} rows`);
    }
    console.log('');

    // 3. Resolve IMDb -> TMDB with concurrency
    console.log(`Resolving IMDb IDs via TMDB /find...`);
    const resolved = new Array(filtered.length).fill(null);
    let checked = 0;
    let matched = 0;
    let skipped = 0;
    let nextIndex = 0;

    const workers = Array.from({ length: Math.min(TMDB_CONCURRENCY, filtered.length) }, async () => {
        while (true) {
            const i = nextIndex++;
            if (i >= filtered.length) return;

            const row = filtered[i];
            const imdbId = row['Const'].trim();

            const result = await findTmdbByImdbId(imdbId);
            checked++;

            if (result?.skip) {
                skipped++;
                console.log(`  [skip] ${imdbId} - ${row['Title']} — ${result.reason}`);
            } else if (result) {
                matched++;
                resolved[i] = {
                    imdbId,
                    csvTitle: row['Title'],
                    csvYear: parseInt(row['Year'], 10) || null,
                    csvGenres: (row['Genres'] || '').split(',').map(g => g.trim()).filter(Boolean),
                    tmdbId: result.tmdbId,
                    mediaType: result.mediaType,
                    canonicalTitle: result.canonicalTitle || row['Title'],
                    canonicalYear: result.canonicalYear || (parseInt(row['Year'], 10) || null),
                };
            } else {
                console.log(`  [miss] ${imdbId} - ${row['Title']} (${row['Year'] || '?'}) — not found on TMDB`);
            }

            if (checked % 25 === 0 || checked === filtered.length) {
                console.log(`  Progress: ${checked}/${filtered.length} checked, ${matched} matched, ${skipped} skipped`);
            }
        }
    });

    await Promise.all(workers);

    console.log(`\nResolved ${matched}/${filtered.length} titles (${skipped} skipped, ${filtered.length - matched - skipped} not found)`);

    // 4. Build recommendation records.
    // mentions/score/sentiment here mirror Reddit-scraped data so the engine
    // treats these as organic Reddit signals. See parseArgs() for how each
    // field influences the ranking pipeline (primary-candidate gating,
    // boost magnitude, CTR normalization, sentiment bonus).
    const recommendations = resolved.filter(Boolean).map(r => ({
        id: generateId(15),
        title: r.canonicalTitle,
        tmdbId: r.tmdbId,
        releaseYear: r.canonicalYear,
        mediaType: r.mediaType,
        subreddit: args.subreddit,
        postId: r.imdbId,                 // traceable back to IMDb
        postTitle: r.csvTitle,            // original title from the list
        mentionCount: args.mentions,      // gates primary-candidate eligibility (>=2); boost = mentions*30
        totalScore: args.score,           // gates primary-candidate eligibility (>=50); ranks via mentions*score
        sentiment: args.sentiment,        // 'positive' adds +20 to the boost
        genres: r.csvGenres,
    }));

    if (recommendations.length === 0) {
        console.log('\nNo recommendations to import.');
        return;
    }

    // 5. Save (or dry-run summary)
    if (args.dryRun) {
        console.log('\n=== Dry Run — no database writes ===');
        console.log(`Would import ${recommendations.length} recommendations:`);
        for (const rec of recommendations.slice(0, 10)) {
            console.log(`  ${rec.tmdbId} (${rec.mediaType}) — ${rec.title} (${rec.releaseYear ?? '?'}) [${rec.postId}]`);
        }
        if (recommendations.length > 10) {
            console.log(`  ... and ${recommendations.length - 10} more`);
        }
        return;
    }

    console.log(`\nSaving ${recommendations.length} recommendations to database...`);
    const savedCount = await saveToDatabase(recommendations);

    console.log(`\n=== Import Complete ===`);
    console.log(`  Saved/updated: ${savedCount}`);
    console.log(`  Subreddit tag: ${args.subreddit}`);
    console.log(`  Mention count: ${args.mentions}, total score: ${args.score}, sentiment: ${args.sentiment}`);
    console.log('\nThese will now be picked up by the recommendation engine as Reddit boosts.');
    console.log('To make them visible to existing cached users, invalidate the recommendation cache or wait for the 30-min TTL.');
}

main().catch(error => {
    console.error('Import failed:', error);
    process.exit(1);
});
