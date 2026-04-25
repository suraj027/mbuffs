import { Request, Response, NextFunction } from 'express';
import { sql } from '../lib/db.js';
import { UserPreferences, UpdateUserPreferencesInput } from '../lib/types.js';
import { invalidateRecommendationCache, warmPersonalizedRecommendationCache } from '../services/recommendationService.js';
// Import to ensure Express Request extension is applied
import '../middleware/authMiddleware.js';

// Max base64 payload size (~2 MB of base64 ≈ ~1.5 MB image)
const MAX_AVATAR_BASE64_LENGTH = 2 * 1024 * 1024;

export const getUserPreferences = async (req: Request, res: Response, next: NextFunction) => {
    if (!req.userId) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    try {
        const result = await sql`
            SELECT recommendations_enabled, recommendations_collection_id, category_recommendations_enabled, show_adult_items, show_reddit_label, show_movie_card_info
            FROM "user"
            WHERE id = ${req.userId}
        `;

        if (result.length === 0) {
            return res.status(404).json({ message: "User not found" });
        }

        const user = result[0];
        const preferences: UserPreferences = {
            recommendations_enabled: user.recommendations_enabled ?? false,
            recommendations_collection_id: user.recommendations_collection_id ?? null,
            category_recommendations_enabled: user.category_recommendations_enabled ?? false,
            show_adult_items: user.show_adult_items ?? false,
            show_reddit_label: user.show_reddit_label ?? true,
            show_movie_card_info: user.show_movie_card_info ?? false,
        };

        res.status(200).json({ preferences });
    } catch (error) {
        console.error("Error fetching user preferences:", error);
        next(error);
    }
};

export const updateUserPreferences = async (req: Request, res: Response, next: NextFunction) => {
    if (!req.userId) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    const {
        recommendations_enabled,
        recommendations_collection_id,
        category_recommendations_enabled,
        show_adult_items,
        show_reddit_label,
        show_movie_card_info,
    } = req.body as UpdateUserPreferencesInput;

    try {
        // If a collection ID is provided, verify the user owns it or has access
        if (recommendations_collection_id !== undefined && recommendations_collection_id !== null) {
            const collectionCheck = await sql`
                SELECT id FROM collections
                WHERE id = ${recommendations_collection_id}
                AND (owner_id = ${req.userId} OR id IN (
                    SELECT collection_id FROM collection_collaborators WHERE user_id = ${req.userId}
                ))
            `;

            if (collectionCheck.length === 0) {
                return res.status(400).json({
                    message: "Invalid collection: You don't have access to this collection"
                });
            }
        }

        // Check if any valid field is provided
        const hasRecommendationsEnabled = recommendations_enabled !== undefined;
        const hasCollectionId = recommendations_collection_id !== undefined;
        const hasCategoryRecommendations = category_recommendations_enabled !== undefined;
        const hasShowAdultItems = show_adult_items !== undefined;
        const hasShowRedditLabel = show_reddit_label !== undefined;
        const hasShowMovieCardInfo = show_movie_card_info !== undefined;

        if (!hasRecommendationsEnabled && !hasCollectionId && !hasCategoryRecommendations && !hasShowAdultItems && !hasShowRedditLabel && !hasShowMovieCardInfo) {
            return res.status(400).json({ message: "No valid fields to update" });
        }

        // Get current values first
        const currentResult = await sql`
            SELECT recommendations_enabled, recommendations_collection_id, category_recommendations_enabled, show_adult_items, show_reddit_label, show_movie_card_info
            FROM "user"
            WHERE id = ${req.userId}
        `;

        if (currentResult.length === 0) {
            return res.status(404).json({ message: "User not found" });
        }

        const current = currentResult[0];

        // Merge current values with updates
        const newRecommendationsEnabled = hasRecommendationsEnabled ? recommendations_enabled : current.recommendations_enabled;
        const newCollectionId = hasCollectionId ? recommendations_collection_id : current.recommendations_collection_id;
        const newCategoryRecommendations = hasCategoryRecommendations ? category_recommendations_enabled : current.category_recommendations_enabled;
        const newShowAdultItems = hasShowAdultItems ? show_adult_items : current.show_adult_items;
        const newShowRedditLabel = hasShowRedditLabel ? show_reddit_label : current.show_reddit_label;
        const newShowMovieCardInfo = hasShowMovieCardInfo ? show_movie_card_info : current.show_movie_card_info;

        // Update all fields
        const result = await sql`
            UPDATE "user"
            SET recommendations_enabled = ${newRecommendationsEnabled},
                recommendations_collection_id = ${newCollectionId},
                category_recommendations_enabled = ${newCategoryRecommendations},
                show_adult_items = ${newShowAdultItems},
                show_reddit_label = ${newShowRedditLabel},
                show_movie_card_info = ${newShowMovieCardInfo},
                updated_at = NOW()
            WHERE id = ${req.userId}
            RETURNING recommendations_enabled, recommendations_collection_id, category_recommendations_enabled, show_adult_items, show_reddit_label, show_movie_card_info
        `;

        if (result.length === 0) {
            return res.status(404).json({ message: "User not found" });
        }

        const updatedUser = result[0];

        const shouldInvalidateRecommendationCache = (
            newRecommendationsEnabled !== current.recommendations_enabled ||
            newCollectionId !== current.recommendations_collection_id ||
            newCategoryRecommendations !== current.category_recommendations_enabled ||
            newShowAdultItems !== current.show_adult_items
        );

        if (shouldInvalidateRecommendationCache) {
            await invalidateRecommendationCache(req.userId);
            if (newRecommendationsEnabled) {
                warmPersonalizedRecommendationCache(req.userId);
            }
        }

        const preferences: UserPreferences = {
            recommendations_enabled: updatedUser.recommendations_enabled ?? false,
            recommendations_collection_id: updatedUser.recommendations_collection_id ?? null,
            category_recommendations_enabled: updatedUser.category_recommendations_enabled ?? false,
            show_adult_items: updatedUser.show_adult_items ?? true,
            show_reddit_label: updatedUser.show_reddit_label ?? true,
            show_movie_card_info: updatedUser.show_movie_card_info ?? false,
        };

        res.status(200).json({ preferences });
    } catch (error) {
        console.error("Error updating user preferences:", error);
        next(error);
    }
};

// ============================================================================
// Avatar upload — stores base64 data in avatar_url, sets image to serving URL
// ============================================================================
export const uploadAvatar = async (req: Request, res: Response, next: NextFunction) => {
    if (!req.userId) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    try {
        const { dataUrl } = req.body as { dataUrl?: string };

        if (!dataUrl || typeof dataUrl !== 'string') {
            return res.status(400).json({ message: "Missing dataUrl in request body" });
        }

        if (!dataUrl.startsWith('data:image/')) {
            return res.status(400).json({ message: "Invalid image data URL" });
        }

        if (dataUrl.length > MAX_AVATAR_BASE64_LENGTH) {
            return res.status(400).json({ message: "Image is too large. Please use a smaller image." });
        }

        // Only store in avatar_url — leave image (Google profile pic) untouched
        await sql`
            UPDATE "user"
            SET avatar_url = ${dataUrl},
                updated_at = NOW()
            WHERE id = ${req.userId}
        `;

        const backendUrl = process.env.BETTER_AUTH_URL || 'http://localhost:5001';
        const servingUrl = `${backendUrl}/api/user/avatar/${req.userId}`;
        res.status(200).json({ avatarUrl: servingUrl });
    } catch (error) {
        console.error("Error uploading avatar:", error);
        next(error);
    }
};

// ============================================================================
// Serve avatar image — decodes base64 from avatar_url and returns raw image
// ============================================================================
export const getAvatar = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { userId } = req.params;

        const result = await sql`
            SELECT avatar_url FROM "user" WHERE id = ${userId}
        `;

        if (result.length === 0 || !result[0].avatar_url) {
            return res.status(404).json({ message: "No avatar found" });
        }

        const dataUrl: string = result[0].avatar_url;

        // Parse data URL: data:image/webp;base64,AAAA...
        const match = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
        if (!match) {
            return res.status(404).json({ message: "Invalid avatar data" });
        }

        const contentType = match[1];
        const buffer = Buffer.from(match[2], 'base64');

        // Cache for 1 hour, allow CDN caching
        res.set('Content-Type', contentType);
        res.set('Cache-Control', 'public, max-age=3600');
        res.set('Content-Length', buffer.length.toString());
        res.send(buffer);
    } catch (error) {
        console.error("Error serving avatar:", error);
        next(error);
    }
};

// ============================================================================
// Remove avatar — clears both avatar_url and image fields
// ============================================================================
export const removeAvatar = async (req: Request, res: Response, next: NextFunction) => {
    if (!req.userId) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    try {
        // Only clear avatar_url — leave image (Google profile pic) untouched
        await sql`
            UPDATE "user"
            SET avatar_url = NULL,
                updated_at = NOW()
            WHERE id = ${req.userId}
        `;

        res.status(200).json({ message: "Avatar removed" });
    } catch (error) {
        console.error("Error removing avatar:", error);
        next(error);
    }
};
