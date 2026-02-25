import { Request, Response, NextFunction } from 'express';
import { sql } from '../lib/db.js';
import { generateId } from '../lib/utils.js';
import { z } from 'zod';
import {
    createCollectionSchema,
    updateCollectionSchema,
    addMovieSchema,
    addCollaboratorSchema,
    updateCollaboratorSchema
} from '../lib/validators.js';

import {
    CollectionCollaborator, 
    CollectionMovieEntry, 
    CollectionSummary, 
    CollectionRow
} from '../lib/types.js'; 
import {
    invalidateRecommendationCache,
    invalidateRecommendationCacheByCollection
} from '../services/recommendationService.js';

interface CollectionDetailsResponse {
    collection: CollectionSummary;
    movies: CollectionMovieEntry[];
    collaborators: CollectionCollaborator[];
}

//modify collectionSummary type
export const getUserCollections = async (req: Request, res: Response, next: NextFunction) => {
    console.log("Fetching user collections", req.userId);
    const userId = req.userId;
    if (!userId) {
        res.sendStatus(401);
        return;
    }
    try {
        // Get collections with preview movie IDs (up to 4 per collection)
        // Using a subquery approach to avoid DISTINCT issues with JSON
        // Also includes user's permission: 'owner', 'edit', or 'view'
        const collections = await sql`
            SELECT c.id, c.name, c.description, c.owner_id, c.created_at, c.updated_at,
                   u.username as owner_username, COALESCE(u.image, u.avatar_url) as owner_avatar,
                   (
                       SELECT COALESCE(json_agg(movie_id), '[]'::json)
                       FROM (
                           SELECT movie_id
                           FROM collection_movies
                           WHERE collection_id = c.id
                           ORDER BY added_at DESC
                           LIMIT 4
                       ) sub
                   ) as preview_movie_ids,
                   CASE 
                       WHEN c.owner_id = ${userId} THEN 'owner'
                       ELSE (
                           SELECT cc.permission 
                           FROM collection_collaborators cc 
                           WHERE cc.collection_id = c.id AND cc.user_id = ${userId}
                       )
                   END as user_permission
            FROM collections c
            JOIN "user" u ON c.owner_id = u.id
            WHERE c.id IN (
                SELECT DISTINCT col.id
                FROM collections col
                LEFT JOIN collection_collaborators cc ON col.id = cc.collection_id
                WHERE (col.owner_id = ${userId} OR cc.user_id = ${userId})
                  AND (col.is_system = false OR col.is_system IS NULL)
            )
            ORDER BY c.updated_at DESC
        `;
        res.status(200).json({ collections: collections });
    } catch (error) {
        next(error);
    }
};

export const getCollectionById = async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.userId;
    const { collectionId } = req.params;
    if (!userId) {
        res.sendStatus(401);
        return;
    }
    try {
        const collectionResult = await sql`
            SELECT c.*, u.username as owner_username, COALESCE(u.image, u.avatar_url) as owner_avatar
            FROM collections c
            JOIN "user" u ON c.owner_id = u.id
            WHERE c.id = ${collectionId}
        `;

        if (collectionResult.length === 0) {
            res.status(404).json({ message: 'Collection not found' });
            return;
        }
        const collectionData = collectionResult[0];
        
        const collectionSummary: CollectionSummary = {
             id: collectionData.id,
             name: collectionData.name,
             description: collectionData.description,
             owner_id: collectionData.owner_id,
             created_at: collectionData.created_at,
             updated_at: collectionData.updated_at,
             owner_username: collectionData.owner_username,
             owner_avatar: collectionData.owner_avatar,
        };

        const moviesResult = await sql`
            SELECT cm.movie_id, cm.is_movie, cm.added_at, cm.added_by_user_id, COALESCE(u.username, u.name) as added_by_username
            FROM collection_movies cm
            JOIN "user" u ON cm.added_by_user_id = u.id
            WHERE cm.collection_id = ${collectionId}
            ORDER BY cm.added_at DESC
        `;

        const collaboratorsResult = await sql`
            SELECT cc.user_id, cc.permission, u.username, u.email, COALESCE(u.image, u.avatar_url) as avatar_url
            FROM collection_collaborators cc
            JOIN "user" u ON cc.user_id = u.id
            WHERE cc.collection_id = ${collectionId}
        `;
        
        const responseData: CollectionDetailsResponse = {
             collection: collectionSummary,
             movies: (moviesResult as (CollectionMovieEntry & { added_by_username: string | null; added_by_user_id: string })[]).map(m => ({ movie_id: m.movie_id, added_at: m.added_at, added_by_username: m.added_by_username, added_by_user_id: m.added_by_user_id, is_movie: m.is_movie })), 
             collaborators: collaboratorsResult as CollectionCollaborator[]
        };

        res.status(200).json(responseData);
    } catch (error) {
        next(error);
    }
};

export const createCollection = async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.userId;
    if (!userId) { 
        res.sendStatus(401);
        return;
     }
    try {
        const validation = createCollectionSchema.safeParse(req.body);
        if (!validation.success) {
            res.status(400).json({ message: 'Validation failed', errors: validation.error.issues });
            return;
        }
        const { name, description } = validation.data;
        const newCollectionId = generateId(21);
        const newShareableId = generateId(12);

        const result = await sql`
            INSERT INTO collections (id, name, description, owner_id, shareable_id)
            VALUES (${newCollectionId}, ${name}, ${description}, ${userId}, ${newShareableId})
            RETURNING *
        `;

        res.status(201).json({ collection: result[0] as CollectionRow });
    } catch(error) {
        next(error);
    }
};

export const updateCollection = async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.userId;
    const { collectionId } = req.params;
    if (!userId) { 
        res.sendStatus(401);
        return;
     }
    try {
        const validation = updateCollectionSchema.safeParse(req.body);
        if (!validation.success) {
            res.status(400).json({ message: 'Validation failed', errors: validation.error.issues });
            return;
        }
        const { name, description } = validation.data;

        if (name === undefined && description === undefined) {
             res.status(400).json({ message: 'No update data provided' });
             return;
        }

        // Build the update dynamically using tagged template
        let result;
        if (name !== undefined && description !== undefined) {
            result = await sql`
                UPDATE collections 
                SET updated_at = CURRENT_TIMESTAMP, name = ${name}, description = ${description}
                WHERE id = ${collectionId}
                RETURNING *
            `;
        } else if (name !== undefined) {
            result = await sql`
                UPDATE collections 
                SET updated_at = CURRENT_TIMESTAMP, name = ${name}
                WHERE id = ${collectionId}
                RETURNING *
            `;
        } else {
            result = await sql`
                UPDATE collections 
                SET updated_at = CURRENT_TIMESTAMP, description = ${description}
                WHERE id = ${collectionId}
                RETURNING *
            `;
        }

        if (result.length === 0) {
            res.status(404).json({ message: 'Collection not found or no changes made' });
            return;
        }

        res.status(200).json({ collection: result[0] as CollectionRow });
    } catch(error) {
        next(error);
    }
};

export const deleteCollection = async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.userId;
    const { collectionId } = req.params;
    if (!userId) { 
        res.sendStatus(401);
        return;
    }
    try {
        const deleteResult = await sql`
            DELETE FROM collections
            WHERE id = ${collectionId} AND owner_id = ${userId}
            RETURNING id
        `;

        if (deleteResult.length === 0) {
            const exists = await sql`SELECT 1 FROM collections WHERE id = ${collectionId}`;
            if (exists.length > 0) {
                res.status(403).json({ message: 'Forbidden: Only the owner can delete this collection' });
            } else {
                res.status(404).json({ message: 'Collection not found' });
            }
            return;
        }

        await invalidateRecommendationCacheByCollection(collectionId);
        await invalidateRecommendationCache(userId);

        res.status(204).send();
    } catch(error) {
        next(error);
    }
};

export const addMovieToCollection = async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.userId;
    const { collectionId } = req.params;
    if (!userId) { 
        res.sendStatus(401);
        return;
    }
    try {
        // Check if user is owner or has edit permission
        const permissionCheck = await sql`
            SELECT 
                CASE 
                    WHEN c.owner_id = ${userId} THEN 'owner'
                    WHEN cc.permission = 'edit' THEN 'edit'
                    WHEN cc.permission = 'view' THEN 'view'
                    ELSE NULL
                END as role
            FROM collections c
            LEFT JOIN collection_collaborators cc ON c.id = cc.collection_id AND cc.user_id = ${userId}
            WHERE c.id = ${collectionId}
        `;

        if (permissionCheck.length === 0) {
            res.status(404).json({ message: 'Collection not found' });
            return;
        }

        const role = permissionCheck[0].role;
        if (!role || role === 'view') {
            res.status(403).json({ message: 'You do not have permission to add items to this collection' });
            return;
        }

        const validation = addMovieSchema.safeParse(req.body);
        if (!validation.success) {
            res.status(400).json({ message: 'Validation failed', errors: validation.error.issues });
            return;
        }
        const { movieId } = validation.data;
        const newEntryId = generateId(21);

        try {
            const result = await sql`
                INSERT INTO collection_movies (id, collection_id, movie_id, added_by_user_id)
                VALUES (${newEntryId}, ${collectionId}, ${movieId}, ${userId})
                RETURNING id, movie_id, added_at
            `;

            await invalidateRecommendationCacheByCollection(collectionId);
            await invalidateRecommendationCache(userId);

            res.status(201).json({ movieEntry: result[0] as {id: string, movie_id: number, added_at: string} });
        } catch (insertError: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
            if (insertError.code === '23505') { 
                res.status(409).json({ message: 'Movie already exists in this collection' });
            } else {
                next(insertError); 
            }
        }
    } catch (error) {
        next(error);
    }
};

export const removeMovieFromCollection = async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.userId;
    const { collectionId, movieId } = req.params;
    if (!userId) { 
        res.sendStatus(401);
        return;
    }
    try {
        // Check user's role and get movie's added_by_user_id
        const permissionCheck = await sql`
            SELECT 
                CASE 
                    WHEN c.owner_id = ${userId} THEN 'owner'
                    WHEN cc.permission = 'edit' THEN 'edit'
                    WHEN cc.permission = 'view' THEN 'view'
                    ELSE NULL
                END as role,
                cm.added_by_user_id
            FROM collections c
            LEFT JOIN collection_collaborators cc ON c.id = cc.collection_id AND cc.user_id = ${userId}
            LEFT JOIN collection_movies cm ON c.id = cm.collection_id AND cm.movie_id = ${movieId}
            WHERE c.id = ${collectionId}
        `;

        if (permissionCheck.length === 0) {
            res.status(404).json({ message: 'Collection not found' });
            return;
        }

        const { role, added_by_user_id } = permissionCheck[0];
        
        if (!role || role === 'view') {
            res.status(403).json({ message: 'You do not have permission to remove items from this collection' });
            return;
        }

        // Edit role can only remove items they added, owner can remove any
        if (role === 'edit' && added_by_user_id !== userId) {
            res.status(403).json({ message: 'You can only remove items that you added' });
            return;
        }

        // movie_id can be a number (for movies) or string with 'tv' suffix (for TV shows)
        const deleteResult = await sql`
            DELETE FROM collection_movies
            WHERE collection_id = ${collectionId} AND movie_id = ${movieId}
            RETURNING id
        `;

        if (deleteResult.length === 0) {
            res.status(404).json({ message: 'Movie not found in this collection' });
            return;
        }

        await invalidateRecommendationCacheByCollection(collectionId);
        await invalidateRecommendationCache(userId);

        res.status(204).send();
    } catch (error) {
        next(error);
    }
};

export const addCollaborator = async (req: Request, res: Response, next: NextFunction) => {
    const inviterId = req.userId;
    const { collectionId } = req.params;
    if (!inviterId) { 
        res.sendStatus(401);
        return;
     }
    try {
        const validation = addCollaboratorSchema.safeParse(req.body);
        if (!validation.success) {
            res.status(400).json({ message: 'Validation failed', errors: validation.error.issues });
            return;
        }
        const { email, permission } = validation.data;

        const userToInvite = await sql`SELECT id FROM "user" WHERE email = ${email}`;
        if (userToInvite.length === 0) {
            res.status(404).json({ message: `User with email ${email} not found` });
            return;
        }
        const inviteeId = (userToInvite[0] as {id: string}).id;

        const ownerCheck = await sql`SELECT 1 FROM collections WHERE id = ${collectionId} AND owner_id = ${inviteeId}`;
        if (ownerCheck.length > 0) {
             res.status(400).json({ message: 'Cannot add the collection owner as a collaborator' });
             return;
        }

        const newCollaboratorId = generateId(21);

        try {
            const insertResult = await sql`
                INSERT INTO collection_collaborators (id, collection_id, user_id, permission)
                VALUES (${newCollaboratorId}, ${collectionId}, ${inviteeId}, ${permission})
                RETURNING id, user_id, permission, added_at
            `;
            
            const collaboratorDetails = await sql`
                SELECT u.id as user_id, cc.permission, u.username, u.email, COALESCE(u.image, u.avatar_url) as avatar_url
                FROM "user" u
                JOIN collection_collaborators cc ON u.id = cc.user_id
                WHERE cc.id = ${(insertResult[0] as {id: string}).id}
            `;

            res.status(201).json({ collaborator: collaboratorDetails[0] as CollectionCollaborator });
        } catch (insertError: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
            if (insertError.code === '23505') {
                res.status(409).json({ message: 'User is already a collaborator on this collection' });
            } else {
                next(insertError);
            }
        }
    } catch(error) {
        next(error);
    }
};

export const updateCollaboratorPermission = async (req: Request, res: Response, next: NextFunction) => {
    const { collectionId, userId: collaboratorUserId } = req.params;
    const requesterId = req.userId;
    if (!requesterId) { 
        res.sendStatus(401);
        return;
     }
    try {
        const validation = updateCollaboratorSchema.safeParse(req.body);
        if (!validation.success) {
            res.status(400).json({ message: 'Validation failed', errors: validation.error.issues });
            return;
        }
        const { permission } = validation.data;

        const result = await sql`
            UPDATE collection_collaborators
            SET permission = ${permission}
            WHERE collection_id = ${collectionId} AND user_id = ${collaboratorUserId}
            RETURNING id, user_id, permission
        `;

        if (result.length === 0) {
            res.status(404).json({ message: 'Collaborator not found on this collection' });
            return;
        }

        res.status(200).json({ collaborator: result[0] as {id: string, user_id: string, permission: string} });
    } catch(error) {
        next(error);
    }
};

export const removeCollaborator = async (req: Request, res: Response, next: NextFunction) => {
    const { collectionId, userId: collaboratorUserId } = req.params;
     const requesterId = req.userId;
    if (!requesterId) { 
        res.sendStatus(401);
        return;
    }
    try {
        const deleteResult = await sql`
            DELETE FROM collection_collaborators
            WHERE collection_id = ${collectionId} AND user_id = ${collaboratorUserId}
            RETURNING id
        `;

        if (deleteResult.length === 0) {
            res.status(404).json({ message: 'Collaborator not found on this collection' });
            return;
        }

        res.status(204).send();
    } catch (error) {
        next(error);
    }
};

// ============================================================================
// WATCHED COLLECTION (System Collection)
// ============================================================================

const WATCHED_COLLECTION_NAME = '__watched__';
const NOT_INTERESTED_COLLECTION_NAME = '__not_interested__';

const getSystemCollectionItemsByName = async (userId: string, collectionName: string) => {
    const result = await sql`
        SELECT cm.movie_id, cm.added_at
        FROM collection_movies cm
        JOIN collections c ON cm.collection_id = c.id
        WHERE c.owner_id = ${userId}
          AND c.is_system = true
          AND c.name = ${collectionName}
        ORDER BY cm.added_at DESC
    `;

    return result as { movie_id: string; added_at: string }[];
};

/**
 * Get the watched status for a specific media item
 */
export const getWatchedStatus = async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.userId;
    const { mediaId } = req.params;
    
    if (!userId) {
        res.sendStatus(401);
        return;
    }
    
    try {
        // Check if the media is in the user's watched collection
        const result = await sql`
            SELECT cm.id, cm.added_at
            FROM collection_movies cm
            JOIN collections c ON cm.collection_id = c.id
            WHERE c.owner_id = ${userId} 
              AND c.is_system = true 
              AND c.name = ${WATCHED_COLLECTION_NAME}
              AND cm.movie_id = ${mediaId}
            LIMIT 1
        `;
        
        res.status(200).json({ 
            isWatched: result.length > 0,
            watchedAt: result.length > 0 ? result[0].added_at : null
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Get watched status for multiple media items (batch)
 */
export const getWatchedStatusBatch = async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.userId;
    const { mediaIds } = req.body;
    
    if (!userId) {
        res.sendStatus(401);
        return;
    }
    
    if (!Array.isArray(mediaIds) || mediaIds.length === 0) {
        res.status(400).json({ message: 'mediaIds must be a non-empty array' });
        return;
    }
    
    try {
        const result = await sql`
            SELECT cm.movie_id, cm.added_at
            FROM collection_movies cm
            JOIN collections c ON cm.collection_id = c.id
            WHERE c.owner_id = ${userId} 
              AND c.is_system = true 
              AND c.name = ${WATCHED_COLLECTION_NAME}
              AND cm.movie_id = ANY(${mediaIds}::text[])
        `;
        
        // Create a map of mediaId -> watched info
        const watchedMap: Record<string, { isWatched: boolean; watchedAt: string | null }> = {};
        for (const mediaId of mediaIds) {
            const found = result.find((r) => r.movie_id === String(mediaId));
            watchedMap[mediaId] = {
                isWatched: !!found,
                watchedAt: found ? found.added_at : null
            };
        }
        
        res.status(200).json({ watchedStatus: watchedMap });
    } catch (error) {
        next(error);
    }
};

/**
 * Get all watched media entries for the authenticated user
 */
export const getWatchedItems = async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.userId;

    if (!userId) {
        res.sendStatus(401);
        return;
    }

    try {
        const items = await getSystemCollectionItemsByName(userId, WATCHED_COLLECTION_NAME);
        res.status(200).json({ items });
    } catch (error) {
        next(error);
    }
};

/**
 * Toggle watched status for a media item
 * Creates the watched collection if it doesn't exist
 */
export const toggleWatchedStatus = async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.userId;
    const { mediaId } = req.params;
    
    if (!userId) {
        res.sendStatus(401);
        return;
    }
    
    try {
        // First, get or create the watched collection
        const watchedCollection = await sql`
            SELECT id FROM collections 
            WHERE owner_id = ${userId} 
              AND is_system = true 
              AND name = ${WATCHED_COLLECTION_NAME}
            LIMIT 1
        `;
        
        let collectionId: string;
        
        if (watchedCollection.length === 0) {
            // Create the watched collection
            const newCollectionId = generateId(21);
            await sql`
                INSERT INTO collections (id, name, description, owner_id, is_system)
                VALUES (${newCollectionId}, ${WATCHED_COLLECTION_NAME}, 'System collection for watched items', ${userId}, true)
            `;
            collectionId = newCollectionId;
        } else {
            collectionId = watchedCollection[0].id as string;
        }
        
        // Check if the media is already in the watched collection
        const existing = await sql`
            SELECT id FROM collection_movies 
            WHERE collection_id = ${collectionId} AND movie_id = ${mediaId}
            LIMIT 1
        `;
        
        if (existing.length > 0) {
            // Remove from watched
            await sql`
                DELETE FROM collection_movies 
                WHERE collection_id = ${collectionId} AND movie_id = ${mediaId}
            `;
            await invalidateRecommendationCache(userId);
            res.status(200).json({ isWatched: false, message: 'Removed from watched' });
        } else {
            // Add to watched
            const newEntryId = generateId(21);
            await sql`
                INSERT INTO collection_movies (id, collection_id, movie_id, added_by_user_id)
                VALUES (${newEntryId}, ${collectionId}, ${mediaId}, ${userId})
            `;
            await invalidateRecommendationCache(userId);
            res.status(200).json({ isWatched: true, message: 'Added to watched' });
        }
    } catch (error) {
        next(error);
    }
};

// ============================================================================
// NOT INTERESTED COLLECTION (System Collection)
// ============================================================================

/**
 * Get the not interested status for a specific media item
 */
export const getNotInterestedStatus = async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.userId;
    const { mediaId } = req.params;
    
    if (!userId) {
        res.sendStatus(401);
        return;
    }
    
    try {
        const result = await sql`
            SELECT cm.id, cm.added_at
            FROM collection_movies cm
            JOIN collections c ON cm.collection_id = c.id
            WHERE c.owner_id = ${userId} 
              AND c.is_system = true 
              AND c.name = ${NOT_INTERESTED_COLLECTION_NAME}
              AND cm.movie_id = ${mediaId}
            LIMIT 1
        `;
        
        res.status(200).json({ 
            isNotInterested: result.length > 0,
            notInterestedAt: result.length > 0 ? result[0].added_at : null
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Get not interested status for multiple media items (batch)
 */
export const getNotInterestedStatusBatch = async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.userId;
    const { mediaIds } = req.body;
    
    if (!userId) {
        res.sendStatus(401);
        return;
    }
    
    if (!Array.isArray(mediaIds) || mediaIds.length === 0) {
        res.status(400).json({ message: 'mediaIds must be a non-empty array' });
        return;
    }
    
    try {
        const result = await sql`
            SELECT cm.movie_id, cm.added_at
            FROM collection_movies cm
            JOIN collections c ON cm.collection_id = c.id
            WHERE c.owner_id = ${userId} 
              AND c.is_system = true 
              AND c.name = ${NOT_INTERESTED_COLLECTION_NAME}
              AND cm.movie_id = ANY(${mediaIds}::text[])
        `;
        
        const notInterestedMap: Record<string, { isNotInterested: boolean; notInterestedAt: string | null }> = {};
        for (const mediaId of mediaIds) {
            const found = result.find((r) => r.movie_id === String(mediaId));
            notInterestedMap[mediaId] = {
                isNotInterested: !!found,
                notInterestedAt: found ? found.added_at : null
            };
        }
        
        res.status(200).json({ notInterestedStatus: notInterestedMap });
    } catch (error) {
        next(error);
    }
};

/**
 * Get all not interested media entries for the authenticated user
 */
export const getNotInterestedItems = async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.userId;

    if (!userId) {
        res.sendStatus(401);
        return;
    }

    try {
        const items = await getSystemCollectionItemsByName(userId, NOT_INTERESTED_COLLECTION_NAME);
        res.status(200).json({ items });
    } catch (error) {
        next(error);
    }
};

/**
 * Toggle not interested status for a media item
 * Creates the not interested collection if it doesn't exist
 */
export const toggleNotInterestedStatus = async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.userId;
    const { mediaId } = req.params;
    
    if (!userId) {
        res.sendStatus(401);
        return;
    }
    
    try {
        // First, get or create the not interested collection
        const notInterestedCollection = await sql`
            SELECT id FROM collections 
            WHERE owner_id = ${userId} 
              AND is_system = true 
              AND name = ${NOT_INTERESTED_COLLECTION_NAME}
            LIMIT 1
        `;
        
        let collectionId: string;
        
        if (notInterestedCollection.length === 0) {
            const newCollectionId = generateId(21);
            await sql`
                INSERT INTO collections (id, name, description, owner_id, is_system)
                VALUES (${newCollectionId}, ${NOT_INTERESTED_COLLECTION_NAME}, 'System collection for not interested items', ${userId}, true)
            `;
            collectionId = newCollectionId;
        } else {
            collectionId = notInterestedCollection[0].id as string;
        }
        
        const existing = await sql`
            SELECT id FROM collection_movies 
            WHERE collection_id = ${collectionId} AND movie_id = ${mediaId}
            LIMIT 1
        `;
        
        if (existing.length > 0) {
            await sql`
                DELETE FROM collection_movies 
                WHERE collection_id = ${collectionId} AND movie_id = ${mediaId}
            `;
            await invalidateRecommendationCache(userId);
            res.status(200).json({ isNotInterested: false, message: 'Removed from not interested' });
        } else {
            const newEntryId = generateId(21);
            await sql`
                INSERT INTO collection_movies (id, collection_id, movie_id, added_by_user_id)
                VALUES (${newEntryId}, ${collectionId}, ${mediaId}, ${userId})
            `;
            await invalidateRecommendationCache(userId);
            res.status(200).json({ isNotInterested: true, message: 'Added to not interested' });
        }
    } catch (error) {
        next(error);
    }
};
