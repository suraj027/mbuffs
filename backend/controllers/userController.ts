import { Request, Response, NextFunction } from 'express';
import { sql } from '../lib/db.js';
import { UserPreferences, UpdateUserPreferencesInput } from '../lib/types.js';
import { invalidateRecommendationCache } from '../services/recommendationService.js';
// Import to ensure Express Request extension is applied
import '../middleware/authMiddleware.js';

export const getUserPreferences = async (req: Request, res: Response, next: NextFunction) => {
    if (!req.userId) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    try {
        const result = await sql`
            SELECT recommendations_enabled, recommendations_collection_id, category_recommendations_enabled 
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

    const { recommendations_enabled, recommendations_collection_id, category_recommendations_enabled } = req.body as UpdateUserPreferencesInput;

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

        if (!hasRecommendationsEnabled && !hasCollectionId && !hasCategoryRecommendations) {
            return res.status(400).json({ message: "No valid fields to update" });
        }

        // Get current values first
        const currentResult = await sql`
            SELECT recommendations_enabled, recommendations_collection_id, category_recommendations_enabled 
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

        // Update all fields
        const result = await sql`
            UPDATE "user" 
            SET recommendations_enabled = ${newRecommendationsEnabled},
                recommendations_collection_id = ${newCollectionId},
                category_recommendations_enabled = ${newCategoryRecommendations},
                updated_at = NOW()
            WHERE id = ${req.userId}
            RETURNING recommendations_enabled, recommendations_collection_id, category_recommendations_enabled
        `;

        if (result.length === 0) {
            return res.status(404).json({ message: "User not found" });
        }

        const updatedUser = result[0];

        await invalidateRecommendationCache(req.userId);

        const preferences: UserPreferences = {
            recommendations_enabled: updatedUser.recommendations_enabled ?? false,
            recommendations_collection_id: updatedUser.recommendations_collection_id ?? null,
            category_recommendations_enabled: updatedUser.category_recommendations_enabled ?? false,
        };

        res.status(200).json({ preferences });
    } catch (error) {
        console.error("Error updating user preferences:", error);
        next(error);
    }
};
