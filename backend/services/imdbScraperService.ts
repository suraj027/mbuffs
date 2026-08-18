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

// Subset of ParentalGuidanceData returned by the scraper service (no tmdb/media context).
export type ScrapedParentalGuidance = Omit<ParentalGuidanceData, 'tmdbId' | 'mediaType'>;

interface ScraperResponse {
    ok?: boolean;
    imdbId?: string;
    data?: ScrapedParentalGuidance | null;
    error?: string;
}

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
 * Call the standalone scraper microservice (deployed as a separate Vercel project)
 * to fetch parental guidance for an IMDB title. IMDB blocks the main backend's
 * IP, so scraping now runs out-of-band from the scraper service.
 *
 * Requires SCRAPER_URL (the scraper service base URL) and, if the scraper service
 * is configured with one, SCRAPER_API_KEY (shared secret sent as x-scraper-key).
 */
async function scrapeParentalGuidanceViaScraper(imdbId: string): Promise<ScrapedParentalGuidance | null> {
    const scraperUrl = process.env.SCRAPER_URL;
    const scraperKey = process.env.SCRAPER_API_KEY;

    if (!scraperUrl) {
        console.error('SCRAPER_URL is not configured; cannot scrape parental guidance');
        return null;
    }

    const base = scraperUrl.replace(/\/+$/, '');
    const url = `${base}/scrape/parental-guidance/${encodeURIComponent(imdbId)}`;

    try {
        const headers: Record<string, string> = { 'Accept': 'application/json' };
        if (scraperKey) {
            headers['x-scraper-key'] = scraperKey;
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);

        try {
            const response = await fetch(url, { headers, signal: controller.signal });

            if (!response.ok) {
                console.warn(`Scraper request failed for ${imdbId}: ${response.status}`);
                return null;
            }

            const payload = await response.json() as ScraperResponse;

            if (!payload.ok) {
                console.warn(`Scraper returned error for ${imdbId}: ${payload.error || 'unknown error'}`);
                return null;
            }

            return payload.data ?? null;
        } finally {
            clearTimeout(timeout);
        }
    } catch (error) {
        console.warn(`Error calling scraper service for ${imdbId}:`, error);
        return null;
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
 *
 * Scraping is delegated to the standalone scraper microservice (SCRAPER_URL),
 * which runs on a separate Vercel project so IMDB's anti-bot blocks on the
 * main backend's IP don't prevent us from resolving parental guidance.
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
    
    // Scrape from IMDB via the standalone scraper service
    const scrapedData = await scrapeParentalGuidanceViaScraper(imdbId);
    
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