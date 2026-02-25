import { Request, Response, NextFunction } from 'express';
import { sql } from '../lib/db.js';
import {
    generateRecommendationsCached,
    generateCategoryRecommendationsCached,
    generateGenreRecommendationsCached,
    generatePersonalizedTheatricalReleasesCached,
    addRecommendationCollection,
    removeRecommendationCollection,
    setRecommendationCollections,
    getRecommendationCacheDebug
} from '../services/recommendationService.js';
import '../middleware/authMiddleware.js';

const RECOMMENDATION_DEBUG_EMAIL = 'murtuza.creativity@gmail.com';

/**
 * GET /api/recommendations
 * Get personalized recommendations for the authenticated user
 * Supports pagination with ?limit=20&page=1
 */
export const getRecommendations = async (req: Request, res: Response, next: NextFunction) => {
    if (!req.userId) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    try {
        const limit = parseInt(req.query.limit as string) || 20;
        const page = parseInt(req.query.page as string) || 1;
        const recommendations = await generateRecommendationsCached(req.userId, limit, page);
        
        res.status(200).json(recommendations);
    } catch (error) {
        console.error("Error generating recommendations:", error);
        next(error);
    }
};

/**
 * GET /api/recommendations/categories
 * Get personalized category-based recommendations for the authenticated user
 * Supports ?mediaType=movie|tv&limit=10
 */
export const getCategoryRecommendations = async (req: Request, res: Response, next: NextFunction) => {
    if (!req.userId) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    try {
        const mediaType = (req.query.mediaType as 'movie' | 'tv') || 'movie';
        const limit = parseInt(req.query.limit as string) || 10;
        
        if (mediaType !== 'movie' && mediaType !== 'tv') {
            return res.status(400).json({ message: "mediaType must be 'movie' or 'tv'" });
        }

        const recommendations = await generateCategoryRecommendationsCached(req.userId, mediaType, limit);
        
        res.status(200).json(recommendations);
    } catch (error) {
        console.error("Error generating category recommendations:", error);
        next(error);
    }
};

/**
 * GET /api/recommendations/genre/:genreId
 * Get personalized recommendations for a specific genre with pagination
 * Supports ?mediaType=movie|tv&limit=20&page=1
 */
export const getGenreRecommendations = async (req: Request, res: Response, next: NextFunction) => {
    if (!req.userId) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    try {
        const genreId = parseInt(req.params.genreId, 10);
        const mediaType = (req.query.mediaType as 'movie' | 'tv') || 'movie';
        const limit = parseInt(req.query.limit as string) || 20;
        const page = parseInt(req.query.page as string) || 1;

        if (isNaN(genreId)) {
            return res.status(400).json({ message: "Invalid genreId" });
        }

        if (mediaType !== 'movie' && mediaType !== 'tv') {
            return res.status(400).json({ message: "mediaType must be 'movie' or 'tv'" });
        }

        const recommendations = await generateGenreRecommendationsCached(req.userId, genreId, mediaType, limit, page);
        
        res.status(200).json(recommendations);
    } catch (error) {
        console.error("Error generating genre recommendations:", error);
        next(error);
    }
};

/**
 * GET /api/recommendations/theatrical
 * Get personalized theatrical releases (now playing movies)
 * Supports ?limit=20&page=1
 */
export const getTheatricalRecommendations = async (req: Request, res: Response, next: NextFunction) => {
    if (!req.userId) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    try {
        const limit = parseInt(req.query.limit as string) || 20;
        const page = parseInt(req.query.page as string) || 1;

        const recommendations = await generatePersonalizedTheatricalReleasesCached(req.userId, limit, page);
        
        res.status(200).json(recommendations);
    } catch (error) {
        console.error("Error generating theatrical recommendations:", error);
        next(error);
    }
};

/**
 * GET /api/recommendations/collections
 * Get user's recommendation source collections
 */
export const getRecommendationCollections = async (req: Request, res: Response, next: NextFunction) => {
    if (!req.userId) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    try {
        const result = await sql`
            SELECT c.id, c.name, c.description, urc.added_at
            FROM user_recommendation_collections urc
            JOIN collections c ON urc.collection_id = c.id
            WHERE urc.user_id = ${req.userId}
            ORDER BY urc.added_at DESC
        `;

        res.status(200).json({ collections: result });
    } catch (error) {
        console.error("Error fetching recommendation collections:", error);
        next(error);
    }
};

/**
 * GET /api/recommendations/debug/cache
 * Debug cache visibility for a single authorized user
 */
export const getRecommendationCacheDebugHandler = async (req: Request, res: Response, next: NextFunction) => {
    if (!req.userId) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    try {
        const sessionEmail = req.user?.email?.toLowerCase();
        let email = sessionEmail;

        if (!email) {
            const userResult = await sql`
                SELECT email FROM "user" WHERE id = ${req.userId}
            `;
            email = (userResult[0]?.email as string | undefined)?.toLowerCase();
        }

        if (email !== RECOMMENDATION_DEBUG_EMAIL) {
            return res.status(403).json({ message: "Forbidden" });
        }

        const cache = await getRecommendationCacheDebug(req.userId);
        res.status(200).json({
            cache,
            ttl_minutes: 30,
            allowed_debug_email: RECOMMENDATION_DEBUG_EMAIL
        });
    } catch (error) {
        console.error("Error fetching recommendation cache debug data:", error);
        next(error);
    }
};

/**
 * POST /api/recommendations/collections
 * Add a collection to user's recommendation sources
 */
export const addRecommendationCollectionHandler = async (req: Request, res: Response, next: NextFunction) => {
    if (!req.userId) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    const { collection_id } = req.body;

    if (!collection_id) {
        return res.status(400).json({ message: "collection_id is required" });
    }

    try {
        const success = await addRecommendationCollection(req.userId, collection_id);
        
        if (!success) {
            return res.status(400).json({ 
                message: "Invalid collection: You don't have access to this collection" 
            });
        }

        res.status(201).json({ message: "Collection added to recommendation sources" });
    } catch (error) {
        console.error("Error adding recommendation collection:", error);
        next(error);
    }
};

/**
 * DELETE /api/recommendations/collections/:collectionId
 * Remove a collection from user's recommendation sources
 */
export const removeRecommendationCollectionHandler = async (req: Request, res: Response, next: NextFunction) => {
    if (!req.userId) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    const { collectionId } = req.params;

    try {
        await removeRecommendationCollection(req.userId, collectionId);
        res.status(200).json({ message: "Collection removed from recommendation sources" });
    } catch (error) {
        console.error("Error removing recommendation collection:", error);
        next(error);
    }
};

/**
 * PUT /api/recommendations/collections
 * Set all recommendation source collections (replaces existing)
 */
export const setRecommendationCollectionsHandler = async (req: Request, res: Response, next: NextFunction) => {
    if (!req.userId) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    const { collection_ids } = req.body;

    if (!Array.isArray(collection_ids)) {
        return res.status(400).json({ message: "collection_ids must be an array" });
    }

    try {
        const success = await setRecommendationCollections(req.userId, collection_ids);
        
        if (!success) {
            return res.status(400).json({ 
                message: "Invalid collections: You don't have access to one or more collections" 
            });
        }

        // Fetch and return the updated collections
        const result = await sql`
            SELECT c.id, c.name, c.description, urc.added_at
            FROM user_recommendation_collections urc
            JOIN collections c ON urc.collection_id = c.id
            WHERE urc.user_id = ${req.userId}
            ORDER BY urc.added_at DESC
        `;

        res.status(200).json({ collections: result });
    } catch (error) {
        console.error("Error setting recommendation collections:", error);
        next(error);
    }
};
