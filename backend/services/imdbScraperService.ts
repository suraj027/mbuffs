import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { sql } from '../lib/db.js';
import { generateId } from '../lib/utils.js';

// Types
export interface ParentalGuidanceData {
    imdbId: string;
    tmdbId: string;
    mediaType: 'movie' | 'tv';
    nudity: string | null;
    violence: string | null;
    profanity: string | null;
    alcohol: string | null;
    frightening: string | null;
    nudityDescription: string | null;
    violenceDescription: string | null;
    profanityDescription: string | null;
    alcoholDescription: string | null;
    frighteningDescription: string | null;
    scrapedAt?: string | null;
    updatedAt?: string | null;
}

export interface ScrapeMetadata {
    scrapeType: string;
    lastScrapedAt: string;
    itemsScraped: string[];
}

// Severity level mapping
const SEVERITY_LEVELS = ['none', 'mild', 'moderate', 'severe'] as const;
type SeverityLevel = typeof SEVERITY_LEVELS[number];
type SeverityCategoryField = 'nudity' | 'violence' | 'profanity' | 'alcohol' | 'frightening';
type ScrapedParentalGuidance = Omit<ParentalGuidanceData, 'tmdbId' | 'mediaType'>;

// IMDB category IDs
const CATEGORY_MAPPING: Record<string, SeverityCategoryField> = {
    'nudity': 'nudity',
    'violence': 'violence',
    'profanity': 'profanity',
    'alcohol': 'alcohol',
    'frightening': 'frightening',
    'sex': 'nudity', // Sometimes labeled as 'sex' instead of 'nudity'
    'gore': 'violence', // Sometimes labeled as 'gore'
};

const IMDB_GRAPHQL_ENDPOINT = 'https://api.graphql.imdb.com/';
const IMDB_PARENTS_GUIDE_QUERY = `
    query ParentsGuide($id: ID!) {
        title(id: $id) {
            parentsGuide {
                categories {
                    category {
                        id
                        text
                    }
                    severity {
                        id
                        text
                        voteType
                    }
                }
            }
        }
    }
`;

interface ImdbGraphQlParentsGuideResponse {
    data?: {
        title?: {
            parentsGuide?: {
                categories?: Array<{
                    category?: {
                        id?: string;
                        text?: string;
                    };
                    severity?: {
                        id?: string;
                        text?: string;
                        voteType?: string;
                    };
                }>;
            };
        };
    };
    errors?: Array<{ message?: string }>;
}

const IMDB_PARENTAL_GUIDANCE_CACHE_SUCCESS_TTL_MS = 24 * 60 * 60 * 1000;
const IMDB_PARENTAL_GUIDANCE_CACHE_FAILURE_TTL_MS = 15 * 60 * 1000;
const IMDB_PARENTAL_GUIDANCE_CACHE_MAX_ENTRIES = 1000;

interface ImdbParentalGuidanceCacheEntry {
    data: ScrapedParentalGuidance | null;
    expiresAt: number;
}

const imdbParentalGuidanceCache = new Map<string, ImdbParentalGuidanceCacheEntry>();
const imdbParentalGuidanceInFlight = new Map<string, Promise<ScrapedParentalGuidance | null>>();

/**
 * Fetch release date from TMDB API for a given movie/tv show
 * Returns the release_date for movies or first_air_date for TV shows
 */
export async function getReleaseDateFromTmdb(tmdbId: string, mediaType: 'movie' | 'tv'): Promise<Date | null> {
    const TMDB_API_KEY = process.env.TMDB_API_KEY;
    const TMDB_BASE_URL = process.env.TMDB_BASE_URL;

    if (!TMDB_API_KEY || !TMDB_BASE_URL) {
        console.error('TMDB API key or base URL not configured');
        return null;
    }

    try {
        const endpoint = mediaType === 'movie' 
            ? `${TMDB_BASE_URL}/movie/${tmdbId}`
            : `${TMDB_BASE_URL}/tv/${tmdbId}`;

        const url = new URL(endpoint);
        url.searchParams.append('api_key', TMDB_API_KEY);

        const response = await fetch(url.toString());
        if (!response.ok) {
            console.error(`Failed to fetch release date for ${mediaType} ${tmdbId}: ${response.status}`);
            return null;
        }

        const data = await response.json() as { release_date?: string; first_air_date?: string };
        const dateStr = mediaType === 'movie' ? data.release_date : data.first_air_date;
        
        if (!dateStr) return null;
        
        const date = new Date(dateStr);
        return isNaN(date.getTime()) ? null : date;
    } catch (error) {
        console.error(`Error fetching release date for ${mediaType} ${tmdbId}:`, error);
        return null;
    }
}

/**
 * Fetch IMDB ID from TMDB API for a given movie/tv show
 */
export async function getImdbIdFromTmdb(tmdbId: string, mediaType: 'movie' | 'tv'): Promise<string | null> {
    const TMDB_API_KEY = process.env.TMDB_API_KEY;
    const TMDB_BASE_URL = process.env.TMDB_BASE_URL;

    if (!TMDB_API_KEY || !TMDB_BASE_URL) {
        console.error('TMDB API key or base URL not configured');
        return null;
    }

    try {
        const endpoint = mediaType === 'movie' 
            ? `${TMDB_BASE_URL}/movie/${tmdbId}/external_ids`
            : `${TMDB_BASE_URL}/tv/${tmdbId}/external_ids`;

        const url = new URL(endpoint);
        url.searchParams.append('api_key', TMDB_API_KEY);

        const response = await fetch(url.toString());
        if (!response.ok) {
            console.error(`Failed to fetch IMDB ID for ${mediaType} ${tmdbId}: ${response.status}`);
            return null;
        }

        const data = await response.json() as { imdb_id?: string };
        return data.imdb_id || null;
    } catch (error) {
        console.error(`Error fetching IMDB ID for ${mediaType} ${tmdbId}:`, error);
        return null;
    }
}

/**
 * Parse severity level from IMDB page
 */
function parseSeverityLevel(text: string): SeverityLevel | null {
    const lowerText = text.toLowerCase();
    for (const level of SEVERITY_LEVELS) {
        if (lowerText.includes(level)) {
            return level;
        }
    }
    return null;
}

/**
 * Map IMDB severity text to our severity level
 */
function mapImdbSeverity(severityText: string | null | undefined): SeverityLevel | null {
    if (!severityText) return null;
    const lower = severityText.toLowerCase();
    if (lower === 'none' || lower.includes('none')) return 'none';
    if (lower === 'mild' || lower.includes('mild')) return 'mild';
    if (lower === 'moderate' || lower.includes('moderate')) return 'moderate';
    if (lower === 'severe' || lower.includes('severe')) return 'severe';
    return null;
}

function cloneScrapedParentalGuidance(data: ScrapedParentalGuidance | null): ScrapedParentalGuidance | null {
    if (!data) return null;
    return { ...data };
}

function getCachedImdbParentalGuidance(imdbId: string): ScrapedParentalGuidance | null | undefined {
    const cacheEntry = imdbParentalGuidanceCache.get(imdbId);
    if (!cacheEntry) {
        return undefined;
    }

    if (cacheEntry.expiresAt <= Date.now()) {
        imdbParentalGuidanceCache.delete(imdbId);
        return undefined;
    }

    return cloneScrapedParentalGuidance(cacheEntry.data);
}

function setCachedImdbParentalGuidance(
    imdbId: string,
    data: ScrapedParentalGuidance | null,
    ttlMs: number,
): void {
    while (imdbParentalGuidanceCache.size >= IMDB_PARENTAL_GUIDANCE_CACHE_MAX_ENTRIES) {
        const oldestKey = imdbParentalGuidanceCache.keys().next().value as string | undefined;
        if (!oldestKey) break;
        imdbParentalGuidanceCache.delete(oldestKey);
    }

    imdbParentalGuidanceCache.set(imdbId, {
        data: cloneScrapedParentalGuidance(data),
        expiresAt: Date.now() + ttlMs,
    });
}

function createEmptyScrapedResult(imdbId: string): ScrapedParentalGuidance {
    return {
        imdbId,
        nudity: null,
        violence: null,
        profanity: null,
        alcohol: null,
        frightening: null,
        nudityDescription: null,
        violenceDescription: null,
        profanityDescription: null,
        alcoholDescription: null,
        frighteningDescription: null,
    };
}

function hasAnySeverityData(result: ScrapedParentalGuidance): boolean {
    return Boolean(result.nudity || result.violence || result.profanity || result.alcohol || result.frightening);
}

function resolveCategoryField(categoryIdOrText: string | null | undefined): SeverityCategoryField | null {
    if (!categoryIdOrText) return null;

    const normalized = categoryIdOrText.toLowerCase();
    for (const key of Object.keys(CATEGORY_MAPPING)) {
        if (normalized.includes(key)) {
            return CATEGORY_MAPPING[key];
        }
    }

    return null;
}

function setCategorySeverity(
    result: ScrapedParentalGuidance,
    category: SeverityCategoryField | null,
    severity: SeverityLevel | null,
): void {
    if (!category || !severity) return;
    if (!result[category]) {
        result[category] = severity;
    }
}

async function fetchParentalGuidanceFromImdbGraphQl(imdbId: string): Promise<ScrapedParentalGuidance | null> {
    try {
        const response = await fetch(IMDB_GRAPHQL_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.5',
            },
            body: JSON.stringify({
                query: IMDB_PARENTS_GUIDE_QUERY,
                variables: { id: imdbId },
            }),
        });

        if (!response.ok) {
            console.warn(`IMDB GraphQL parental guide request failed for ${imdbId}: ${response.status}`);
            return null;
        }

        const payload = await response.json() as ImdbGraphQlParentsGuideResponse;

        if (payload.errors?.length) {
            console.warn(`IMDB GraphQL parental guide errors for ${imdbId}: ${payload.errors.map(err => err.message).filter(Boolean).join('; ')}`);
        }

        const categories = payload.data?.title?.parentsGuide?.categories;
        if (!categories || categories.length === 0) {
            return null;
        }

        const result = createEmptyScrapedResult(imdbId);

        for (const categorySummary of categories) {
            const category = resolveCategoryField(categorySummary.category?.id)
                ?? resolveCategoryField(categorySummary.category?.text);

            const severity = mapImdbSeverity(categorySummary.severity?.text)
                ?? mapImdbSeverity(categorySummary.severity?.voteType)
                ?? mapImdbSeverity(categorySummary.severity?.id);

            setCategorySeverity(result, category, severity);
        }

        return hasAnySeverityData(result) ? result : null;
    } catch (error) {
        console.warn(`Error fetching IMDB parental guide via GraphQL for ${imdbId}:`, error);
        return null;
    }
}

/**
 * Scrape parental guidance data from IMDB
 * Uses IMDB GraphQL API first, then falls back to HTML parsing.
 */
async function scrapeParentalGuidanceFromImdbUncached(imdbId: string): Promise<ScrapedParentalGuidance | null> {
    const graphQlResult = await fetchParentalGuidanceFromImdbGraphQl(imdbId);
    if (graphQlResult) {
        console.log(`Successfully scraped parental guidance for ${imdbId} via GraphQL:`, {
            nudity: graphQlResult.nudity,
            violence: graphQlResult.violence,
            profanity: graphQlResult.profanity,
            alcohol: graphQlResult.alcohol,
            frightening: graphQlResult.frightening,
        });
        return graphQlResult;
    }

    const url = `https://www.imdb.com/title/${imdbId}/parentalguide`;

    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
            }
        });

        if (!response.ok) {
            console.error(`Failed to fetch IMDB parental guide for ${imdbId}: ${response.status}`);
            return null;
        }

        const html = await response.text();

        const isChallengePage = response.status === 202
            || html.includes('AwsWafIntegration')
            || html.includes('challenge.js')
            || html.includes('gokuProps');

        if (isChallengePage) {
            console.warn(`Could not scrape parental guidance for ${imdbId}: IMDB returned anti-bot challenge page`);
            return null;
        }

        const $ = cheerio.load(html);

        const result = createEmptyScrapedResult(imdbId);

        // Primary HTML method: parse embedded JSON snippets in multiple known formats.
        const categoryPatterns = [
            /"id":"(nudity|violence|profanity|alcohol|frightening)","title":"[^"]*","severitySummaryId":"[^"]*","severitySummaryText":"([^"]*)"/gi,
            /"category":\{"id":"(NUDITY|VIOLENCE|PROFANITY|ALCOHOL|FRIGHTENING)","text":"[^"]*"\},"severity":\{[\s\S]{0,200}?"text":"([^"]+)"/gi,
        ];

        for (const categoryPattern of categoryPatterns) {
            let match: RegExpExecArray | null;
            while ((match = categoryPattern.exec(html)) !== null) {
                const category = resolveCategoryField(match[1]);
                const severity = mapImdbSeverity(match[2]);
                setCategorySeverity(result, category, severity);
            }
        }

        if (hasAnySeverityData(result)) {
            console.log(`Successfully scraped parental guidance for ${imdbId} via HTML JSON patterns:`, {
                nudity: result.nudity,
                violence: result.violence,
                profanity: result.profanity,
                alcohol: result.alcohol,
                frightening: result.frightening,
            });
            return result;
        }

        // Fallback: parse HTML advisory sections.
        $('section[id^="advisory"]').each((_: number, section: Element) => {
            const $section = $(section);
            const sectionId = $section.attr('id') || '';

            const category = resolveCategoryField(sectionId);
            if (!category) return;

            const sectionText = $section.text().toLowerCase();
            const severity = parseSeverityLevel(sectionText);

            setCategorySeverity(result, category, severity);
        });

        // Secondary fallback: inspect raw page text around category IDs.
        const categories = ['nudity', 'violence', 'profanity', 'alcohol', 'frightening', 'sex', 'gore'] as const;
        const pageText = html.toLowerCase();

        for (const cat of categories) {
            const field = CATEGORY_MAPPING[cat];
            if (result[field]) continue;

            const catIndex = pageText.indexOf(`"id":"${cat}"`);

            if (catIndex !== -1) {
                const surroundingText = pageText.substring(
                    catIndex,
                    Math.min(pageText.length, catIndex + 300)
                );

                const severityMatch = surroundingText.match(/severitysummarytext":"([^"]+)"/);
                if (severityMatch) {
                    const severity = mapImdbSeverity(severityMatch[1]);
                    setCategorySeverity(result, field, severity);
                }
            }
        }

        if (!hasAnySeverityData(result)) {
            console.warn(`Could not scrape parental guidance for ${imdbId}: no category severities found on IMDB page`);
            return null;
        }

        console.log(`Scraped parental guidance for ${imdbId} (fallback methods):`, {
            nudity: result.nudity,
            violence: result.violence,
            profanity: result.profanity,
            alcohol: result.alcohol,
            frightening: result.frightening,
        });

        return result;
    } catch (error) {
        console.error(`Error scraping parental guidance for ${imdbId}:`, error);
        return null;
    }
}

/**
 * Scrape parental guidance with in-memory caching and in-flight deduplication
 */
export async function scrapeParentalGuidanceFromImdb(imdbId: string): Promise<ScrapedParentalGuidance | null> {
    const cachedResult = getCachedImdbParentalGuidance(imdbId);
    if (cachedResult !== undefined) {
        console.log(`Using in-memory IMDB parental guidance cache for ${imdbId}`);
        return cachedResult;
    }

    const inFlightRequest = imdbParentalGuidanceInFlight.get(imdbId);
    if (inFlightRequest) {
        return inFlightRequest;
    }

    const scrapePromise = scrapeParentalGuidanceFromImdbUncached(imdbId);
    imdbParentalGuidanceInFlight.set(imdbId, scrapePromise);

    try {
        const scraped = await scrapePromise;
        const ttlMs = scraped
            ? IMDB_PARENTAL_GUIDANCE_CACHE_SUCCESS_TTL_MS
            : IMDB_PARENTAL_GUIDANCE_CACHE_FAILURE_TTL_MS;
        setCachedImdbParentalGuidance(imdbId, scraped, ttlMs);
        return scraped;
    } finally {
        imdbParentalGuidanceInFlight.delete(imdbId);
    }
}

/**
 * Save parental guidance data to database
 */
export async function saveParentalGuidance(data: ParentalGuidanceData): Promise<boolean> {
    try {
        const id = generateId(15);
        
        await sql`
            INSERT INTO parental_guidance (
                id, imdb_id, tmdb_id, media_type,
                nudity, violence, profanity, alcohol, frightening,
                nudity_description, violence_description, profanity_description,
                alcohol_description, frightening_description,
                scraped_at, updated_at
            ) VALUES (
                ${id}, ${data.imdbId}, ${data.tmdbId}, ${data.mediaType},
                ${data.nudity}, ${data.violence}, ${data.profanity}, ${data.alcohol}, ${data.frightening},
                ${data.nudityDescription}, ${data.violenceDescription}, ${data.profanityDescription},
                ${data.alcoholDescription}, ${data.frighteningDescription},
                NOW(), NOW()
            )
            ON CONFLICT (imdb_id) DO UPDATE SET
                nudity = EXCLUDED.nudity,
                violence = EXCLUDED.violence,
                profanity = EXCLUDED.profanity,
                alcohol = EXCLUDED.alcohol,
                frightening = EXCLUDED.frightening,
                nudity_description = EXCLUDED.nudity_description,
                violence_description = EXCLUDED.violence_description,
                profanity_description = EXCLUDED.profanity_description,
                alcohol_description = EXCLUDED.alcohol_description,
                frightening_description = EXCLUDED.frightening_description,
                updated_at = NOW()
        `;
        
        return true;
    } catch (error) {
        console.error(`Error saving parental guidance for ${data.imdbId}:`, error);
        return false;
    }
}

/**
 * Get parental guidance from database (includes scraped_at timestamp)
 */
export async function getParentalGuidanceFromDb(
    tmdbId: string, 
    mediaType: 'movie' | 'tv'
): Promise<ParentalGuidanceData | null> {
    try {
        const result = await sql`
            SELECT 
                imdb_id as "imdbId",
                tmdb_id as "tmdbId",
                media_type as "mediaType",
                nudity, violence, profanity, alcohol, frightening,
                nudity_description as "nudityDescription",
                violence_description as "violenceDescription",
                profanity_description as "profanityDescription",
                alcohol_description as "alcoholDescription",
                frightening_description as "frighteningDescription",
                scraped_at as "scrapedAt"
            FROM parental_guidance 
            WHERE tmdb_id = ${tmdbId} AND media_type = ${mediaType}
        `;
        
        if (result.length === 0) {
            return null;
        }
        
        return result[0] as ParentalGuidanceData;
    } catch (error) {
        console.error(`Error fetching parental guidance for ${mediaType} ${tmdbId}:`, error);
        return null;
    }
}

/**
 * Get last scrape metadata
 */
export async function getLastScrapeMetadata(scrapeType: string): Promise<ScrapeMetadata | null> {
    try {
        const result = await sql`
            SELECT 
                scrape_type as "scrapeType",
                last_scraped_at as "lastScrapedAt",
                items_scraped as "itemsScraped"
            FROM scrape_metadata 
            WHERE scrape_type = ${scrapeType}
        `;
        
        if (result.length === 0) {
            return null;
        }
        
        const row = result[0];
        return {
            scrapeType: row.scrapeType,
            lastScrapedAt: row.lastScrapedAt,
            itemsScraped: row.itemsScraped ? JSON.parse(row.itemsScraped) : [],
        };
    } catch (error) {
        console.error(`Error fetching scrape metadata for ${scrapeType}:`, error);
        return null;
    }
}

/**
 * Update scrape metadata
 */
export async function updateScrapeMetadata(
    scrapeType: string, 
    itemsScraped: string[]
): Promise<boolean> {
    try {
        const id = generateId(15);
        
        await sql`
            INSERT INTO scrape_metadata (id, scrape_type, last_scraped_at, items_scraped)
            VALUES (${id}, ${scrapeType}, NOW(), ${JSON.stringify(itemsScraped)})
            ON CONFLICT (scrape_type) DO UPDATE SET
                last_scraped_at = NOW(),
                items_scraped = EXCLUDED.items_scraped
        `;
        
        return true;
    } catch (error) {
        console.error(`Error updating scrape metadata for ${scrapeType}:`, error);
        return false;
    }
}

/**
 * Check if a scrape is needed (more than 7 days since last scrape)
 */
export async function isScrapeNeeded(scrapeType: string): Promise<boolean> {
    const metadata = await getLastScrapeMetadata(scrapeType);
    
    if (!metadata) {
        return true;
    }
    
    const lastScraped = new Date(metadata.lastScrapedAt);
    const now = new Date();
    const daysSinceLastScrape = (now.getTime() - lastScraped.getTime()) / (1000 * 60 * 60 * 24);
    
    return daysSinceLastScrape >= 7;
}

// Re-scrape thresholds based on content age
const RESCRAPE_THRESHOLD_NEW_CONTENT_DAYS = 7;      // 7 days for content < 6 months old
const NEW_CONTENT_AGE_THRESHOLD_DAYS = 180;         // Content is "new" if released within 6 months

/**
 * Check if data needs to be re-scraped based on content age
 * - New releases (< 6 months old): re-scrape every 7 days
 * - Older releases (>= 6 months old): never re-scrape, trust existing data
 */
function needsRescrape(scrapedAt: string | null | undefined, releaseDate: Date | null): boolean {
    if (!scrapedAt) return true;
    
    const now = new Date();
    
    // Determine if content is "new" based on release date
    let isNewContent = true; // Default to treating as new if no release date
    if (releaseDate) {
        const daysSinceRelease = (now.getTime() - releaseDate.getTime()) / (1000 * 60 * 60 * 24);
        isNewContent = daysSinceRelease < NEW_CONTENT_AGE_THRESHOLD_DAYS;
    }
    
    // Old content: never re-scrape, trust existing data
    if (!isNewContent) {
        return false;
    }
    
    // New content: re-scrape if data is older than threshold
    const lastScraped = new Date(scrapedAt);
    const daysSinceLastScrape = (now.getTime() - lastScraped.getTime()) / (1000 * 60 * 60 * 24);
    
    return daysSinceLastScrape >= RESCRAPE_THRESHOLD_NEW_CONTENT_DAYS;
}

/**
 * Count how many categories have data
 */
function countFilledCategories(data: Partial<ParentalGuidanceData> | null): number {
    if (!data) return 0;
    const categories = [data.nudity, data.violence, data.profanity, data.alcohol, data.frightening];
    return categories.filter(c => c !== null && c !== undefined).length;
}

/**
 * Check if parental guidance data is complete (has multiple categories)
 */
function isDataComplete(data: ParentalGuidanceData | null): boolean {
    // Consider data complete if at least 3 categories are filled
    // (some movies may legitimately have fewer categories rated)
    return countFilledCategories(data) >= 3;
}

/**
 * Merge scraped data with existing data, preserving existing non-null values
 * Only overwrites null fields with new data, never overwrites good data with nulls
 */
function mergeParentalGuidanceData(
    existing: ParentalGuidanceData | null,
    newData: Omit<ParentalGuidanceData, 'tmdbId' | 'mediaType'>
): Omit<ParentalGuidanceData, 'tmdbId' | 'mediaType'> {
    if (!existing) return newData;
    
    return {
        imdbId: newData.imdbId || existing.imdbId,
        // Only use new value if it's not null, otherwise keep existing
        nudity: newData.nudity ?? existing.nudity,
        violence: newData.violence ?? existing.violence,
        profanity: newData.profanity ?? existing.profanity,
        alcohol: newData.alcohol ?? existing.alcohol,
        frightening: newData.frightening ?? existing.frightening,
        nudityDescription: newData.nudityDescription ?? existing.nudityDescription,
        violenceDescription: newData.violenceDescription ?? existing.violenceDescription,
        profanityDescription: newData.profanityDescription ?? existing.profanityDescription,
        alcoholDescription: newData.alcoholDescription ?? existing.alcoholDescription,
        frighteningDescription: newData.frighteningDescription ?? existing.frighteningDescription,
    };
}

/**
 * Scrape and save parental guidance for a specific item
 * - Returns cached data if available, complete, and within re-scrape threshold
 * - Re-scrape threshold depends on content age:
 *   - New releases (< 6 months old): re-scrape every 7 days
 *   - Older releases (>= 6 months old): re-scrape every 6 months
 */
export async function scrapeAndSaveParentalGuidance(
    tmdbId: string,
    mediaType: 'movie' | 'tv'
): Promise<ParentalGuidanceData | null> {
    // Check if we have cached data
    const existing = await getParentalGuidanceFromDb(tmdbId, mediaType);
    
    // Fetch release date to determine re-scrape threshold
    const releaseDate = await getReleaseDateFromTmdb(tmdbId, mediaType);
    
    // If cached data exists, is complete, and within re-scrape threshold, return it
    if (existing && isDataComplete(existing) && !needsRescrape(existing.scrapedAt, releaseDate)) {
        const contentAge = releaseDate 
            ? `released ${Math.floor((Date.now() - releaseDate.getTime()) / (1000 * 60 * 60 * 24))} days ago`
            : 'unknown release date';
        console.log(`Using cached parental guidance for ${mediaType} ${tmdbId} (scraped ${existing.scrapedAt}, ${contentAge})`);
        return existing;
    }
    
    // Need to scrape - either no data, data is stale, or data is incomplete
    if (existing) {
        if (!isDataComplete(existing)) {
            console.log(`Cached data for ${mediaType} ${tmdbId} is incomplete, re-scraping...`);
        } else {
            console.log(`Cached data for ${mediaType} ${tmdbId} is stale (threshold: ${RESCRAPE_THRESHOLD_NEW_CONTENT_DAYS} days), re-scraping...`);
        }
    }
    
    // Get IMDB ID - use existing if available, otherwise fetch from TMDB
    let imdbId = existing?.imdbId || null;
    
    if (!imdbId) {
        imdbId = await getImdbIdFromTmdb(tmdbId, mediaType);
    }
    
    if (!imdbId) {
        console.log(`No IMDB ID found for ${mediaType} ${tmdbId}`);
        // Return existing data even if stale/incomplete, better than nothing
        return existing;
    }
    
    // Scrape from IMDB
    const scrapedData = await scrapeParentalGuidanceFromImdb(imdbId);
    
    if (!scrapedData) {
        console.warn(`Failed to scrape parental guidance for ${mediaType} ${tmdbId} (IMDB ${imdbId})`);
        // Return existing data if scrape fails, better than nothing
        return existing;
    }

    const scrapedCount = countFilledCategories(scrapedData);
    if (scrapedCount === 0) {
        console.warn(`Scrape returned no parental guidance categories for ${mediaType} ${tmdbId} (IMDB ${imdbId})`);
    }
    
    // Merge scraped data with existing data
    // This preserves existing non-null values and only fills in nulls with new data
    const mergedData = mergeParentalGuidanceData(existing, scrapedData);
    
    const fullData: ParentalGuidanceData = {
        ...mergedData,
        tmdbId,
        mediaType,
    };
    
    // Only save if we have new data to add (avoid unnecessary DB writes)
    const existingCount = countFilledCategories(existing);
    const mergedCount = countFilledCategories(fullData);
    
    if (mergedCount > existingCount || !existing) {
        const saved = await saveParentalGuidance(fullData);
        
        if (!saved) {
            console.error(`Failed to save parental guidance for ${imdbId}`);
            return existing; // Return existing data instead of null
        }
        console.log(`Saved parental guidance for ${imdbId} (${existingCount} -> ${mergedCount} categories)`);
    } else {
        console.log(`No new data to save for ${imdbId}, keeping existing (${existingCount} categories)`);
    }
    
    return fullData;
}
