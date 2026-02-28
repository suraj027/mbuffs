import { Request, Response, NextFunction } from 'express';
import { sql } from '../lib/db.js';

type PermissionLevel = 'view' | 'edit';

// Helper function to check permissions
const checkPermission = async (userId: string | null | undefined, collectionId: string, requiredLevel: PermissionLevel): Promise<{ exists: boolean; hasPermission: boolean }> => {
    try {
        const collectionCheck = await sql`
            SELECT owner_id, is_public
            FROM collections
            WHERE id = ${collectionId}
            LIMIT 1
        `;

        if (collectionCheck.length === 0) {
            return { exists: false, hasPermission: false };
        }

        const collection = collectionCheck[0] as { owner_id: string; is_public: boolean | null };

        if (requiredLevel === 'view' && Boolean(collection.is_public)) {
            return { exists: true, hasPermission: true };
        }

        if (!userId) {
            return { exists: true, hasPermission: false };
        }

        if (collection.owner_id === userId) {
            return { exists: true, hasPermission: true }; // Owner has all permissions
        }

        const collaboratorCheck = await sql`
            SELECT permission FROM collection_collaborators
            WHERE collection_id = ${collectionId} AND user_id = ${userId}
        `;

        if (collaboratorCheck.length === 0) {
            return { exists: true, hasPermission: false };
        }

        const actualPermission = collaboratorCheck[0].permission as PermissionLevel;

        if (requiredLevel === 'view') {
            return { exists: true, hasPermission: true }; // Both 'view' and 'edit' collaborators can view
        }

        if (requiredLevel === 'edit') {
            return { exists: true, hasPermission: actualPermission === 'edit' };
        }

        return { exists: true, hasPermission: false };

    } catch (error) {
        console.error('Permission check error:', error);
        return { exists: true, hasPermission: false }; // Deny access on error
    }
};

// Middleware factory to require specific permission level
export const requireCollectionPermission = (requiredLevel: PermissionLevel) => {
    return async (req: Request, res: Response, next: NextFunction) => {
        const userId = req.userId;
        const collectionId = req.params.collectionId;

        if (!collectionId) {
            return res.status(400).json({ message: 'Bad Request: Collection ID missing in request parameters' });
        }

        const permissionResult = await checkPermission(userId, collectionId, requiredLevel);

        if (!permissionResult.exists) {
            return res.status(404).json({ message: 'Collection not found' });
        }

        if (!permissionResult.hasPermission) {
            if (!userId && requiredLevel === 'view') {
                return res.status(401).json({ message: 'Unauthorized: Authentication required' });
            }
            return res.status(403).json({ message: `Forbidden: You do not have '${requiredLevel}' permission for this collection` });
        }

        // User has the required permission, proceed
        next();
    };
};
