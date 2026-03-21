import { Request, Response, NextFunction } from 'express';
import { sql } from '../lib/db.js';
import { AdminUserResponse } from '../lib/types.js';

interface AdminUserRow {
    id: string;
    name: string;
    email: string;
    email_verified: boolean;
    image: string | null;
    username: string | null;
    avatar_url: string | null;
    first_name: string | null;
    last_name: string | null;
    role: string;
    created_at: string | Date;
    updated_at: string | Date;
    recommendations_enabled: boolean | null;
    recommendations_collection_id: string | null;
    category_recommendations_enabled: boolean | null;
}

interface CollectionCountRow {
    owner_id: string;
    collection_count: string | number;
}

interface AccountProviderRow {
    user_id: string;
    provider_id: string;
}

const toIsoString = (value: string | Date): string => {
    if (typeof value === 'string') {
        return value;
    }

    return value.toISOString();
};

export const getAllUsers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const usersResult = await sql`
            SELECT id, name, email, email_verified, image, username, avatar_url, first_name, last_name, role, created_at, updated_at, recommendations_enabled, recommendations_collection_id, category_recommendations_enabled
            FROM "user"
            ORDER BY created_at DESC
        `;

        const collectionCountsResult = await sql`
            SELECT owner_id, COUNT(*) as collection_count
            FROM collections
            GROUP BY owner_id
        `;

        const accountProvidersResult = await sql`
            SELECT user_id, provider_id
            FROM account
            ORDER BY created_at ASC
        `;

        const collectionCountByOwnerId = new Map<string, number>(
            (collectionCountsResult as CollectionCountRow[]).map((row) => [
                row.owner_id,
                Number(row.collection_count) || 0,
            ])
        );

        const providersByUserId = new Map<string, string[]>();
        for (const row of accountProvidersResult as AccountProviderRow[]) {
            const existing = providersByUserId.get(row.user_id) ?? [];
            if (!existing.includes(row.provider_id)) {
                existing.push(row.provider_id);
            }
            providersByUserId.set(row.user_id, existing);
        }

        const backendUrl = process.env.BETTER_AUTH_URL || 'http://localhost:5001';

        const users: AdminUserResponse[] = (usersResult as AdminUserRow[]).map((userRow) => ({
            id: userRow.id,
            name: userRow.name,
            email: userRow.email,
            emailVerified: Boolean(userRow.email_verified),
            image: userRow.image ?? null,
            username: userRow.username ?? null,
            avatarUrl: userRow.avatar_url ? `${backendUrl}/api/user/avatar/${userRow.id}` : null,
            firstName: userRow.first_name ?? null,
            lastName: userRow.last_name ?? null,
            role: userRow.role ?? 'user',
            createdAt: toIsoString(userRow.created_at),
            updatedAt: toIsoString(userRow.updated_at),
            recommendationsEnabled: userRow.recommendations_enabled ?? false,
            recommendationsCollectionId: userRow.recommendations_collection_id ?? null,
            categoryRecommendationsEnabled: userRow.category_recommendations_enabled ?? false,
            providers: providersByUserId.get(userRow.id) ?? [],
            collectionCount: collectionCountByOwnerId.get(userRow.id) ?? 0,
        }));

        res.status(200).json({ users, total: users.length });
    } catch (error) {
        console.error('Error fetching admin users:', error);
        next(error);
    }
};
