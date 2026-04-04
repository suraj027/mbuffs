import type { Request, Response, NextFunction } from 'express';
import { sql } from '../lib/db.js';
import { generateId } from '../lib/utils.js';
import {
    commentsPaginationSchema,
    createCommentSchema,
    deleteCommentSchema,
    mediaIdentityParamsSchema,
    updateCommentSchema,
    upsertRatingSchema,
} from '../lib/validators.js';
import type { PaginatedCommentsResponse, ReviewSummaryResponse } from '../lib/types.js';
import '../middleware/authMiddleware.js';

const encodeCursor = (createdAt: string, id: string): string => {
    return Buffer.from(JSON.stringify({ createdAt, id })).toString('base64url');
};

const decodeCursor = (cursor: string): { createdAt: string; id: string } | null => {
    try {
        const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
        if (!parsed || typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string') {
            return null;
        }

        return parsed;
    } catch {
        return null;
    }
};

const buildSummary = async (
    mediaType: 'movie' | 'tv',
    tmdbId: number,
    userId?: string | null
): Promise<ReviewSummaryResponse> => {
    const [aggregate] = await sql`
        SELECT
            COALESCE(ROUND(AVG(rating)::numeric, 1), NULL) AS average_rating,
            COUNT(*)::int AS ratings_count
        FROM media_ratings
        WHERE media_type = ${mediaType} AND tmdb_id = ${tmdbId}
    `;

    const [commentsAggregate] = await sql`
        SELECT COUNT(*)::int AS comments_count
        FROM media_comments
        WHERE media_type = ${mediaType} AND tmdb_id = ${tmdbId} AND deleted_at IS NULL
    `;

    let userRating: number | null = null;
    if (userId) {
        const userRows = await sql`
            SELECT rating
            FROM media_ratings
            WHERE user_id = ${userId} AND media_type = ${mediaType} AND tmdb_id = ${tmdbId}
            LIMIT 1
        `;
        userRating = userRows.length > 0 ? Number(userRows[0].rating) : null;
    }

    return {
        media: { mediaType, tmdbId },
        summary: {
            averageRating: aggregate?.average_rating === null || aggregate?.average_rating === undefined
                ? null
                : Number(aggregate.average_rating),
            ratingsCount: Number(aggregate?.ratings_count ?? 0),
            commentsCount: Number(commentsAggregate?.comments_count ?? 0),
        },
        userRating,
    };
};

export const getReviewSummary = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const parsed = mediaIdentityParamsSchema.safeParse(req.params);
        if (!parsed.success) {
            return res.status(400).json({ message: 'Validation failed', errors: parsed.error.issues });
        }

        const { mediaType, tmdbId } = parsed.data;
        const payload = await buildSummary(mediaType, tmdbId, req.userId);
        res.status(200).json(payload);
    } catch (error) {
        next(error);
    }
};

export const getComments = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const paramsParsed = mediaIdentityParamsSchema.safeParse(req.params);
        if (!paramsParsed.success) {
            return res.status(400).json({ message: 'Validation failed', errors: paramsParsed.error.issues });
        }

        const queryParsed = commentsPaginationSchema.safeParse(req.query);
        if (!queryParsed.success) {
            return res.status(400).json({ message: 'Validation failed', errors: queryParsed.error.issues });
        }

        const { mediaType, tmdbId } = paramsParsed.data;
        const { cursor, limit } = queryParsed.data;
        const decodedCursor = cursor ? decodeCursor(cursor) : null;

        if (cursor && !decodedCursor) {
            return res.status(400).json({ message: 'Invalid cursor' });
        }

        const rows = decodedCursor
            ? await sql`
                SELECT
                    c.id,
                    c.user_id,
                    c.media_type,
                    c.tmdb_id,
                    c.comment,
                    c.created_at,
                    c.updated_at,
                    COALESCE(u.name, u.username) AS author_name,
                    COALESCE(u.image, u.avatar_url) AS author_avatar_url
                FROM media_comments c
                JOIN "user" u ON u.id = c.user_id
                WHERE c.media_type = ${mediaType}
                  AND c.tmdb_id = ${tmdbId}
                  AND c.deleted_at IS NULL
                  AND (
                    c.created_at < ${decodedCursor.createdAt}::timestamptz
                    OR (c.created_at = ${decodedCursor.createdAt}::timestamptz AND c.id < ${decodedCursor.id})
                  )
                ORDER BY c.created_at DESC, c.id DESC
                LIMIT ${limit + 1}
            `
            : await sql`
                SELECT
                    c.id,
                    c.user_id,
                    c.media_type,
                    c.tmdb_id,
                    c.comment,
                    c.created_at,
                    c.updated_at,
                    COALESCE(u.name, u.username) AS author_name,
                    COALESCE(u.image, u.avatar_url) AS author_avatar_url
                FROM media_comments c
                JOIN "user" u ON u.id = c.user_id
                WHERE c.media_type = ${mediaType}
                  AND c.tmdb_id = ${tmdbId}
                  AND c.deleted_at IS NULL
                ORDER BY c.created_at DESC, c.id DESC
                LIMIT ${limit + 1}
            `;

        const hasMore = rows.length > limit;
        const pageRows = hasMore ? rows.slice(0, limit) : rows;
        const lastItem = pageRows.length > 0 ? pageRows[pageRows.length - 1] : null;
        const nextCursor = hasMore && lastItem
            ? encodeCursor(String(lastItem.created_at), String(lastItem.id))
            : null;

        const response: PaginatedCommentsResponse = {
            media: {
                mediaType,
                tmdbId,
            },
            comments: pageRows.map((row) => ({
                id: String(row.id),
                mediaType: row.media_type as 'movie' | 'tv',
                tmdbId: Number(row.tmdb_id),
                comment: String(row.comment),
                createdAt: String(row.created_at),
                updatedAt: String(row.updated_at),
                isEdited: String(row.updated_at) !== String(row.created_at),
                author: {
                    id: String(row.user_id),
                    name: row.author_name ? String(row.author_name) : null,
                    avatarUrl: row.author_avatar_url ? String(row.author_avatar_url) : null,
                },
                isOwner: req.userId ? String(row.user_id) === req.userId : false,
            })),
            pagination: {
                nextCursor,
                hasMore,
                limit,
            },
        };

        res.status(200).json(response);
    } catch (error) {
        next(error);
    }
};

export const upsertRating = async (req: Request, res: Response, next: NextFunction) => {
    if (!req.userId) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    try {
        const paramsParsed = mediaIdentityParamsSchema.safeParse(req.params);
        if (!paramsParsed.success) {
            return res.status(400).json({ message: 'Validation failed', errors: paramsParsed.error.issues });
        }

        const bodyParsed = upsertRatingSchema.safeParse(req.body);
        if (!bodyParsed.success) {
            return res.status(400).json({ message: 'Validation failed', errors: bodyParsed.error.issues });
        }

        const { mediaType, tmdbId } = paramsParsed.data;
        const { rating } = bodyParsed.data;

        const id = generateId(21);

        const rows = await sql`
            INSERT INTO media_ratings (id, user_id, media_type, tmdb_id, rating)
            VALUES (${id}, ${req.userId}, ${mediaType}, ${tmdbId}, ${rating})
            ON CONFLICT (user_id, media_type, tmdb_id)
            DO UPDATE SET rating = EXCLUDED.rating, updated_at = CURRENT_TIMESTAMP
            RETURNING id, user_id, media_type, tmdb_id, rating, created_at, updated_at
        `;

        const summary = await buildSummary(mediaType, tmdbId, req.userId);

        res.status(200).json({
            rating: rows[0],
            summary,
        });
    } catch (error) {
        next(error);
    }
};

export const createComment = async (req: Request, res: Response, next: NextFunction) => {
    if (!req.userId) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    try {
        const paramsParsed = mediaIdentityParamsSchema.safeParse(req.params);
        if (!paramsParsed.success) {
            return res.status(400).json({ message: 'Validation failed', errors: paramsParsed.error.issues });
        }

        const bodyParsed = createCommentSchema.safeParse(req.body);
        if (!bodyParsed.success) {
            return res.status(400).json({ message: 'Validation failed', errors: bodyParsed.error.issues });
        }

        const { mediaType, tmdbId } = paramsParsed.data;
        const id = generateId(21);

        const rows = await sql`
            INSERT INTO media_comments (id, user_id, media_type, tmdb_id, comment)
            VALUES (${id}, ${req.userId}, ${mediaType}, ${tmdbId}, ${bodyParsed.data.comment})
            RETURNING id, user_id, media_type, tmdb_id, comment, created_at, updated_at
        `;

        const created = rows[0];

        const authorRows = await sql`
            SELECT COALESCE(name, username) AS name, COALESCE(image, avatar_url) AS avatar_url
            FROM "user"
            WHERE id = ${req.userId}
            LIMIT 1
        `;

        const author = authorRows[0];

        res.status(201).json({
            comment: {
                id: String(created.id),
                mediaType: created.media_type,
                tmdbId: Number(created.tmdb_id),
                comment: String(created.comment),
                createdAt: String(created.created_at),
                updatedAt: String(created.updated_at),
                isEdited: false,
                author: {
                    id: req.userId,
                    name: author?.name ? String(author.name) : null,
                    avatarUrl: author?.avatar_url ? String(author.avatar_url) : null,
                },
                isOwner: true,
            },
        });
    } catch (error) {
        next(error);
    }
};

export const updateComment = async (req: Request, res: Response, next: NextFunction) => {
    if (!req.userId) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    try {
        const { commentId } = req.params;
        if (!commentId) {
            return res.status(400).json({ message: 'commentId is required' });
        }

        const bodyParsed = updateCommentSchema.safeParse(req.body);
        if (!bodyParsed.success) {
            return res.status(400).json({ message: 'Validation failed', errors: bodyParsed.error.issues });
        }

        const existingRows = await sql`
            SELECT id, user_id, deleted_at
            FROM media_comments
            WHERE id = ${commentId}
            LIMIT 1
        `;

        if (existingRows.length === 0) {
            return res.status(404).json({ message: 'Comment not found' });
        }

        const existing = existingRows[0];
        if (existing.deleted_at) {
            return res.status(404).json({ message: 'Comment not found' });
        }

        const isAdmin = (req.user as { role?: string } | null | undefined)?.role === 'admin';
        const isOwner = String(existing.user_id) === req.userId;

        if (!isOwner && !isAdmin) {
            return res.status(403).json({ message: 'Forbidden: cannot edit this comment' });
        }

        const rows = await sql`
            UPDATE media_comments
            SET comment = ${bodyParsed.data.comment}, updated_at = CURRENT_TIMESTAMP
            WHERE id = ${commentId}
            RETURNING id, user_id, media_type, tmdb_id, comment, created_at, updated_at
        `;

        const updated = rows[0];

        const authorRows = await sql`
            SELECT COALESCE(name, username) AS name, COALESCE(image, avatar_url) AS avatar_url
            FROM "user"
            WHERE id = ${updated.user_id}
            LIMIT 1
        `;

        const author = authorRows[0];

        return res.status(200).json({
            comment: {
                id: String(updated.id),
                mediaType: updated.media_type,
                tmdbId: Number(updated.tmdb_id),
                comment: String(updated.comment),
                createdAt: String(updated.created_at),
                updatedAt: String(updated.updated_at),
                isEdited: String(updated.created_at) !== String(updated.updated_at),
                author: {
                    id: String(updated.user_id),
                    name: author?.name ? String(author.name) : null,
                    avatarUrl: author?.avatar_url ? String(author.avatar_url) : null,
                },
                isOwner,
            },
        });
    } catch (error) {
        next(error);
    }
};

export const deleteComment = async (req: Request, res: Response, next: NextFunction) => {
    if (!req.userId) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    try {
        const { commentId } = req.params;
        if (!commentId) {
            return res.status(400).json({ message: 'commentId is required' });
        }

        const bodyParsed = deleteCommentSchema.safeParse(req.body ?? {});
        if (!bodyParsed.success) {
            return res.status(400).json({ message: 'Validation failed', errors: bodyParsed.error.issues });
        }

        const existingRows = await sql`
            SELECT id, user_id, deleted_at
            FROM media_comments
            WHERE id = ${commentId}
            LIMIT 1
        `;

        if (existingRows.length === 0) {
            return res.status(404).json({ message: 'Comment not found' });
        }

        const existing = existingRows[0];
        if (existing.deleted_at) {
            return res.status(204).send();
        }

        const isAdmin = (req.user as { role?: string } | null | undefined)?.role === 'admin';
        const isOwner = String(existing.user_id) === req.userId;

        if (!isOwner && !isAdmin) {
            return res.status(403).json({ message: 'Forbidden: cannot delete this comment' });
        }

        const reason = bodyParsed.data.reason && bodyParsed.data.reason.length > 0
            ? bodyParsed.data.reason
            : isAdmin && !isOwner
                ? 'Removed by moderation'
                : 'Deleted by owner';

        await sql`
            UPDATE media_comments
            SET
                deleted_at = CURRENT_TIMESTAMP,
                deleted_by_user_id = ${req.userId},
                deletion_reason = ${reason},
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ${commentId}
        `;

        return res.status(204).send();
    } catch (error) {
        next(error);
    }
};
