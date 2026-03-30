import { Request, Response, NextFunction } from 'express';
import { 
    getParentalGuidanceFromDb, 
    scrapeAndSaveParentalGuidance,
    getLastScrapeMetadata,
    isScrapeNeeded
} from '../services/imdbScraperService.js';

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE_URL = process.env.TMDB_BASE_URL;

/**
 * Get parental guidance for a specific movie/TV show
 * This will first check the database, and if not found or stale, will scrape from IMDB
 */
export const getParentalGuidance = async (req: Request, res: Response, next: NextFunction) => {
    const { tmdbId, mediaType } = req.params;

    if (!tmdbId || !mediaType) {
        res.status(400).json({ error: 'Missing tmdbId or mediaType' });
        return;
    }

    if (mediaType !== 'movie' && mediaType !== 'tv') {
        res.status(400).json({ error: 'mediaType must be "movie" or "tv"' });
        return;
    }

    try {
        // First, check database for existing data
        let data = await getParentalGuidanceFromDb(tmdbId, mediaType as 'movie' | 'tv');

        // If we have data, return it
        if (data) {
            res.json({
                source: 'cache',
                data
            });
            return;
        }

        // If no data, scrape from IMDB
        data = await scrapeAndSaveParentalGuidance(tmdbId, mediaType as 'movie' | 'tv');

        if (!data) {
            console.warn(`Could not scrape parental guidance for ${mediaType} ${tmdbId}`);
            res.status(404).json({ 
                error: 'Parental guidance data not available for this title',
                message: 'Could not find IMDB data for this title'
            });
            return;
        }

        res.json({
            source: 'scraped',
            data
        });
    } catch (error) {
        console.error('Error in getParentalGuidance:', error);
        next(error);
    }
};

/**
 * Get certification/content rating from TMDB
 * Movies: use release_dates endpoint
 * TV: use content_ratings endpoint
 */
export const getCertification = async (req: Request, res: Response, next: NextFunction) => {
    const { tmdbId, mediaType } = req.params;
    const region = (req.query.region as string) || 'US';

    if (!tmdbId || !mediaType) {
        res.status(400).json({ error: 'Missing tmdbId or mediaType' });
        return;
    }

    if (!TMDB_API_KEY || !TMDB_BASE_URL) {
        res.status(500).json({ error: 'TMDB API not configured' });
        return;
    }

    try {
        let certification: string | null = null;
        let allCertifications: Array<{ region: string; certification: string }> = [];

        if (mediaType === 'movie') {
            // Fetch release dates for movies
            const url = new URL(`${TMDB_BASE_URL}/movie/${tmdbId}/release_dates`);
            url.searchParams.append('api_key', TMDB_API_KEY);

            const response = await fetch(url.toString());
            if (!response.ok) {
                throw new Error(`TMDB API error: ${response.status}`);
            }

            interface ReleaseDateResult {
                iso_3166_1: string;
                release_dates: Array<{ certification: string; release_date: string; type: number }>;
            }
            const data = await response.json() as { results: ReleaseDateResult[] };

            // Find certification for requested region
            for (const result of data.results || []) {
                const regionCode = result.iso_3166_1;
                for (const release of result.release_dates || []) {
                    if (release.certification) {
                        allCertifications.push({
                            region: regionCode,
                            certification: release.certification
                        });
                        if (regionCode === region && !certification) {
                            certification = release.certification;
                        }
                    }
                }
            }

            // Fallback to US if requested region not found
            if (!certification) {
                const usCert = allCertifications.find(c => c.region === 'US');
                if (usCert) {
                    certification = usCert.certification;
                }
            }
        } else if (mediaType === 'tv') {
            // Fetch content ratings for TV
            const url = new URL(`${TMDB_BASE_URL}/tv/${tmdbId}/content_ratings`);
            url.searchParams.append('api_key', TMDB_API_KEY);

            const response = await fetch(url.toString());
            if (!response.ok) {
                throw new Error(`TMDB API error: ${response.status}`);
            }

            interface ContentRatingResult {
                iso_3166_1: string;
                rating: string;
            }
            const data = await response.json() as { results: ContentRatingResult[] };

            // Find rating for requested region
            for (const result of data.results || []) {
                if (result.rating) {
                    allCertifications.push({
                        region: result.iso_3166_1,
                        certification: result.rating
                    });
                    if (result.iso_3166_1 === region && !certification) {
                        certification = result.rating;
                    }
                }
            }

            // Fallback to US if requested region not found
            if (!certification) {
                const usCert = allCertifications.find(c => c.region === 'US');
                if (usCert) {
                    certification = usCert.certification;
                }
            }
        } else {
            res.status(400).json({ error: 'mediaType must be "movie" or "tv"' });
            return;
        }

        res.json({
            tmdbId,
            mediaType,
            region,
            certification,
            allCertifications: allCertifications.slice(0, 10) // Limit to first 10 regions
        });
    } catch (error) {
        console.error('Error in getCertification:', error);
        next(error);
    }
};

/**
 * Get combined certification and parental guidance data
 */
export const getCombinedRatings = async (req: Request, res: Response, next: NextFunction) => {
    const { tmdbId, mediaType } = req.params;
    const region = (req.query.region as string) || 'US';

    if (!tmdbId || !mediaType) {
        res.status(400).json({ error: 'Missing tmdbId or mediaType' });
        return;
    }

    if (mediaType !== 'movie' && mediaType !== 'tv') {
        res.status(400).json({ error: 'mediaType must be "movie" or "tv"' });
        return;
    }

    try {
        // Fetch both certification and parental guidance in parallel
        const [certificationResult, parentalGuidanceResult] = await Promise.allSettled([
            fetchCertificationInternal(tmdbId, mediaType as 'movie' | 'tv', region),
            fetchParentalGuidanceInternal(tmdbId, mediaType as 'movie' | 'tv')
        ]);

        const certification = certificationResult.status === 'fulfilled' ? certificationResult.value : null;
        const parentalGuidance = parentalGuidanceResult.status === 'fulfilled' ? parentalGuidanceResult.value : null;

        res.json({
            tmdbId,
            mediaType,
            certification,
            parentalGuidance
        });
    } catch (error) {
        console.error('Error in getCombinedRatings:', error);
        next(error);
    }
};

/**
 * Get scrape status/metadata
 */
export const getScrapeStatus = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const metadata = await getLastScrapeMetadata('parental_guidance');
        const needsScrape = await isScrapeNeeded('parental_guidance');

        res.json({
            lastScrapedAt: metadata?.lastScrapedAt || null,
            itemsScrapedCount: metadata?.itemsScraped?.length || 0,
            scrapeNeeded: needsScrape
        });
    } catch (error) {
        console.error('Error in getScrapeStatus:', error);
        next(error);
    }
};

// Internal helper functions
async function fetchCertificationInternal(
    tmdbId: string, 
    mediaType: 'movie' | 'tv', 
    region: string
): Promise<{ certification: string | null; region: string }> {
    if (!TMDB_API_KEY || !TMDB_BASE_URL) {
        return { certification: null, region };
    }

    interface ReleaseDateResult {
        iso_3166_1: string;
        release_dates: Array<{ certification: string; release_date: string; type: number }>;
    }
    interface ContentRatingResult {
        iso_3166_1: string;
        rating: string;
    }

    try {
        if (mediaType === 'movie') {
            const url = new URL(`${TMDB_BASE_URL}/movie/${tmdbId}/release_dates`);
            url.searchParams.append('api_key', TMDB_API_KEY);

            const response = await fetch(url.toString());
            if (!response.ok) return { certification: null, region };

            const data = await response.json() as { results: ReleaseDateResult[] };
            
            // Find certification for requested region
            for (const result of data.results || []) {
                if (result.iso_3166_1 === region) {
                    for (const release of result.release_dates || []) {
                        if (release.certification) {
                            return { certification: release.certification, region };
                        }
                    }
                }
            }
            
            // Fallback to US
            for (const result of data.results || []) {
                if (result.iso_3166_1 === 'US') {
                    for (const release of result.release_dates || []) {
                        if (release.certification) {
                            return { certification: release.certification, region: 'US' };
                        }
                    }
                }
            }
        } else {
            const url = new URL(`${TMDB_BASE_URL}/tv/${tmdbId}/content_ratings`);
            url.searchParams.append('api_key', TMDB_API_KEY);

            const response = await fetch(url.toString());
            if (!response.ok) return { certification: null, region };

            const data = await response.json() as { results: ContentRatingResult[] };
            
            // Find rating for requested region
            for (const result of data.results || []) {
                if (result.iso_3166_1 === region && result.rating) {
                    return { certification: result.rating, region };
                }
            }
            
            // Fallback to US
            for (const result of data.results || []) {
                if (result.iso_3166_1 === 'US' && result.rating) {
                    return { certification: result.rating, region: 'US' };
                }
            }
        }

        return { certification: null, region };
    } catch (error) {
        console.error('Error fetching certification:', error);
        return { certification: null, region };
    }
}

async function fetchParentalGuidanceInternal(
    tmdbId: string, 
    mediaType: 'movie' | 'tv'
): Promise<{
    nudity: string | null;
    violence: string | null;
    profanity: string | null;
    alcohol: string | null;
    frightening: string | null;
} | null> {
    try {
        // First check database
        let data = await getParentalGuidanceFromDb(tmdbId, mediaType);
        
        if (data) {
            return {
                nudity: data.nudity,
                violence: data.violence,
                profanity: data.profanity,
                alcohol: data.alcohol,
                frightening: data.frightening
            };
        }

        // If not in database, scrape
        data = await scrapeAndSaveParentalGuidance(tmdbId, mediaType);
        
        if (data) {
            return {
                nudity: data.nudity,
                violence: data.violence,
                profanity: data.profanity,
                alcohol: data.alcohol,
                frightening: data.frightening
            };
        }

        console.warn(`Could not scrape parental guidance for ${mediaType} ${tmdbId} in combined ratings flow`);

        return null;
    } catch (error) {
        console.error('Error fetching parental guidance:', error);
        return null;
    }
}
