import { Request, Response, NextFunction } from 'express';
import { fetchAndSaveOmdbRatings, getImdbRatingsBatch, getOmdbRatingsFromDb } from '../services/omdbService.js';

export const getOmdbRatings = async (req: Request, res: Response, next: NextFunction) => {
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
        // Anonymous callers are served from the DB cache only. Fetching fresh
        // ratings from the OMDB API (and the INSERT that persists them) is
        // reserved for authenticated users — this endpoint is public, so
        // otherwise bots/crawlers can force unbounded writes + OMDB API usage
        // by enumerating TMDB IDs. Matches the batch endpoint's DB-only design.
        const data = req.userId
            ? await fetchAndSaveOmdbRatings(tmdbId, mediaType as 'movie' | 'tv')
            : await getOmdbRatingsFromDb(tmdbId, mediaType as 'movie' | 'tv');

        // Ratings are global (not user-specific) and change ~daily. Let Vercel's
        // edge cache serve repeat hits so crawlers/bots don't wake the backend
        // (and the DB) for the same title over and over. 404s cache too, which
        // absorbs repeat probes for titles that have no ratings.
        res.set('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate');

        if (!data) {
            res.status(404).json({
                error: 'OMDB ratings not available for this title',
            });
            return;
        }

        res.json({
            tmdbId: data.tmdbId,
            mediaType: data.mediaType,
            imdbId: data.imdbId,
            imdbRating: data.imdbRating,
            imdbVotes: data.imdbVotes,
            rottenTomatoesRating: data.rottenTomatoesRating,
            metacriticRating: data.metacriticRating,
        });
    } catch (error) {
        console.error('[omdb] Error in getOmdbRatings:', error);
        next(error);
    }
};

const BATCH_MAX_ITEMS = 40;

export const getOmdbRatingsBatch = async (req: Request, res: Response, next: NextFunction) => {
    const { items } = req.body as { items?: Array<{ tmdbId: string; mediaType: string }> };

    if (!Array.isArray(items) || items.length === 0) {
        res.status(400).json({ error: 'items array is required' });
        return;
    }

    const validItems = items
        .filter(i => i.tmdbId && (i.mediaType === 'movie' || i.mediaType === 'tv'))
        .slice(0, BATCH_MAX_ITEMS);

    if (validItems.length === 0) {
        res.json({ ratings: {} });
        return;
    }

    try {
        // DB-only lookup — no OMDB API calls to preserve the daily quota.
        // Ratings are populated when users visit detail pages.
        const ratingsMap = await getImdbRatingsBatch(
            validItems.map(i => ({ tmdbId: i.tmdbId, mediaType: i.mediaType as 'movie' | 'tv' }))
        );

        const ratings: Record<string, { imdbRating: number }> = {};
        for (const [key, rating] of ratingsMap) {
            ratings[key] = { imdbRating: rating };
        }

        res.json({ ratings });
    } catch (error) {
        console.error('[omdb] Error in getOmdbRatingsBatch:', error);
        next(error);
    }
};
