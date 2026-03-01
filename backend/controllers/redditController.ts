import { Request, Response, NextFunction } from 'express';
import {
    getRedditRecommendations,
    getRedditRecommendationsByGenre,
    refreshRedditRecommendations,
    isRedditScrapeNeeded,
    getRedditScrapeMetadata,
    type ScrapeOptions,
} from '../services/redditService.js';

/**
 * GET /api/reddit/recommendations
 * Get Reddit-sourced movie recommendations
 * Query params:
 *   - genre: Filter by genre (e.g., "horror", "comedy")
 *   - minMentions: Minimum mention count (default: 2)
 *   - sentiment: Filter by sentiment ("positive", "neutral", "negative")
 *   - limit: Number of results (default: 50, max: 100)
 */
export async function getRecommendationsHandler(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const {
            genre,
            minMentions = '2',
            sentiment,
            limit = '50',
        } = req.query;

        const options = {
            genres: genre ? [genre as string] : [],
            minMentions: Math.max(1, parseInt(minMentions as string, 10) || 2),
            sentiment: sentiment as 'positive' | 'neutral' | 'negative' | undefined,
            limit: Math.min(100, Math.max(1, parseInt(limit as string, 10) || 50)),
            onlyWithTmdb: true,
        };

        const recommendations = await getRedditRecommendations(options);

        res.json({
            success: true,
            count: recommendations.length,
            recommendations,
        });
    } catch (error) {
        next(error);
    }
}

/**
 * GET /api/reddit/recommendations/genre/:genre
 * Get Reddit recommendations filtered by genre
 */
export async function getRecommendationsByGenreHandler(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const { genre } = req.params;
        const { limit = '20' } = req.query;

        if (!genre) {
            res.status(400).json({
                success: false,
                error: 'Genre parameter is required',
            });
            return;
        }

        const recommendations = await getRedditRecommendationsByGenre(
            genre,
            Math.min(50, Math.max(1, parseInt(limit as string, 10) || 20))
        );

        res.json({
            success: true,
            genre,
            count: recommendations.length,
            recommendations,
        });
    } catch (error) {
        next(error);
    }
}

/**
 * POST /api/reddit/scrape
 * Trigger a Reddit scrape (admin only or rate-limited)
 * Body:
 *   - subreddits: Array of subreddit names (optional)
 *   - timeframe: "hour" | "day" | "week" | "month" | "year" | "all" (default: "week")
 *   - postsPerSubreddit: Number of posts per subreddit (default: 25)
 *   - genres: Array of genre keywords to search for (optional)
 *   - force: Force scrape even if recent data exists
 */
export async function triggerScrapeHandler(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const {
            subreddits,
            timeframe = 'week',
            postsPerSubreddit = 25,
            genres,
            force = false,
        } = req.body;

        // Check if scrape is needed (unless forced)
        if (!force) {
            const needsScrape = await isRedditScrapeNeeded();
            if (!needsScrape) {
                const metadata = await getRedditScrapeMetadata();
                res.json({
                    success: true,
                    message: 'Recent scrape data exists, skipping',
                    lastScrapedAt: metadata?.lastScrapedAt,
                    totalRecommendations: metadata?.totalRecommendations,
                });
                return;
            }
        }

        const options: ScrapeOptions = {
            timeframe: timeframe as ScrapeOptions['timeframe'],
            postsPerSubreddit: Math.min(100, Math.max(10, postsPerSubreddit)),
            includeComments: true,
            minScore: 10,
        };

        if (subreddits && Array.isArray(subreddits)) {
            options.subreddits = subreddits.slice(0, 10); // Limit to 10 subreddits
        }

        if (genres && Array.isArray(genres)) {
            options.genres = genres.slice(0, 5); // Limit to 5 genres
        }

        // Run scrape in background
        const result = await refreshRedditRecommendations(options);

        res.json({
            success: true,
            result: {
                totalPostsScraped: result.totalPostsScraped,
                totalMentionsFound: result.totalMentionsFound,
                recommendationsMatched: result.recommendationsMatched,
                recommendationsSaved: result.recommendations.length,
            },
        });
    } catch (error) {
        next(error);
    }
}

/**
 * GET /api/reddit/status
 * Get Reddit scraping status and statistics
 */
export async function getStatusHandler(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const metadata = await getRedditScrapeMetadata();
        const needsScrape = await isRedditScrapeNeeded();

        res.json({
            success: true,
            status: {
                lastScrapedAt: metadata?.lastScrapedAt || null,
                totalRecommendations: metadata?.totalRecommendations || 0,
                needsScrape,
            },
        });
    } catch (error) {
        next(error);
    }
}

/**
 * GET /api/reddit/genres
 * Get list of available genres from Reddit recommendations
 */
export async function getAvailableGenresHandler(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        // Get all recommendations and extract unique genres
        const recommendations = await getRedditRecommendations({
            limit: 500,
            onlyWithTmdb: true,
        });

        const genreCounts = new Map<string, number>();
        
        for (const rec of recommendations) {
            for (const genre of rec.genres) {
                genreCounts.set(genre, (genreCounts.get(genre) || 0) + 1);
            }
        }

        // Sort by count and return
        const genres = Array.from(genreCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([genre, count]) => ({ genre, count }));

        res.json({
            success: true,
            genres,
        });
    } catch (error) {
        next(error);
    }
}
