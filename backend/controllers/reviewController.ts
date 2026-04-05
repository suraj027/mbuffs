import type { Request, Response, NextFunction } from 'express';
import { sql } from '../lib/db.js';
import { generateId } from '../lib/utils.js';
import {
    commentIdParamSchema,
    commentsPaginationSchema,
    createCommentSchema,
    createReplySchema,
    deleteCommentSchema,
    mediaIdentityParamsSchema,
    updateCommentSchema,
    upsertRatingSchema,
} from '../lib/validators.js';
import type {
    CommentLikeResponse,
    PaginatedCommentsResponse,
    ReviewComment,
    ReviewSummaryResponse,
} from '../lib/types.js';
import '../middleware/authMiddleware.js';

type RawCommentRow = {
    id: string;
    user_id: string;
    media_type: 'movie' | 'tv';
    tmdb_id: number;
    parent_comment_id: string | null;
    reply_to_comment_id: string | null;
    reply_to_author_name: string | null;
    comment: string;
    created_at: string;
    updated_at: string;
    author_name: string | null;
    author_avatar_url: string | null;
    likes_count: number;
    liked_by_viewer: boolean;
    replies_count: number;
};

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

const asBoolean = (value: unknown): boolean => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    if (typeof value === 'string') return value === 'true' || value === 't' || value === '1';
    return false;
};

const mapCommentRow = (row: RawCommentRow, userId?: string | null, replies: ReviewComment[] = []): ReviewComment => {
    return {
        id: String(row.id),
        mediaType: row.media_type,
        tmdbId: Number(row.tmdb_id),
        parentCommentId: row.parent_comment_id ? String(row.parent_comment_id) : null,
        replyToCommentId: row.reply_to_comment_id ? String(row.reply_to_comment_id) : null,
        replyToAuthorName: row.reply_to_author_name ? String(row.reply_to_author_name) : null,
        comment: String(row.comment),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
        isEdited: String(row.updated_at) !== String(row.created_at),
        likesCount: Number(row.likes_count ?? 0),
        likedByViewer: asBoolean(row.liked_by_viewer),
        repliesCount: Number(row.replies_count ?? replies.length),
        replies,
        author: {
            id: String(row.user_id),
            name: row.author_name ? String(row.author_name) : null,
            avatarUrl: row.author_avatar_url ? String(row.author_avatar_url) : null,
        },
        isOwner: userId ? String(row.user_id) === userId : false,
    };
};

const getCommentById = async (commentId: string, viewerId?: string | null): Promise<ReviewComment | null> => {
    const rows = await sql`
        SELECT
            c.id,
            c.user_id,
            c.media_type,
            c.tmdb_id,
            c.parent_comment_id,
            c.reply_to_comment_id,
            (
                SELECT COALESCE(ru.name, ru.username)
                FROM media_comments rtc
                JOIN "user" ru ON ru.id = rtc.user_id
                WHERE rtc.id = c.reply_to_comment_id
                LIMIT 1
            ) AS reply_to_author_name,
            c.comment,
            c.created_at,
            c.updated_at,
            COALESCE(u.name, u.username) AS author_name,
            COALESCE(u.image, u.avatar_url) AS author_avatar_url,
            (
                SELECT COUNT(*)::int
                FROM media_comment_likes l
                WHERE l.comment_id = c.id
            ) AS likes_count,
            EXISTS (
                SELECT 1
                FROM media_comment_likes l
                WHERE l.comment_id = c.id
                  AND l.user_id = ${viewerId ?? ''}
            ) AS liked_by_viewer,
            (
                SELECT COUNT(*)::int
                FROM media_comments rc
                WHERE rc.parent_comment_id = c.id
                  AND rc.deleted_at IS NULL
            ) AS replies_count
        FROM media_comments c
        JOIN "user" u ON u.id = c.user_id
        WHERE c.id = ${commentId}
          AND c.deleted_at IS NULL
        LIMIT 1
    `;

    if (rows.length === 0) {
        return null;
    }

    return mapCommentRow(rows[0] as RawCommentRow, viewerId, []);
};

const getCommentLikeSnapshot = async (commentId: string, viewerId: string): Promise<CommentLikeResponse> => {
    const rows = await sql`
        SELECT
            (
                SELECT COUNT(*)::int
                FROM media_comment_likes
                WHERE comment_id = ${commentId}
            ) AS likes_count,
            EXISTS (
                SELECT 1
                FROM media_comment_likes
                WHERE comment_id = ${commentId}
                  AND user_id = ${viewerId}
            ) AS liked_by_viewer
    `;

    const row = rows[0] as { likes_count?: number; liked_by_viewer?: boolean } | undefined;

    return {
        commentId,
        likesCount: Number(row?.likes_count ?? 0),
        likedByViewer: asBoolean(row?.liked_by_viewer),
    };
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
        WHERE media_type = ${mediaType}
          AND tmdb_id = ${tmdbId}
          AND parent_comment_id IS NULL
          AND deleted_at IS NULL
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
                    c.parent_comment_id,
                    c.reply_to_comment_id,
                    (
                        SELECT COALESCE(ru.name, ru.username)
                        FROM media_comments rtc
                        JOIN "user" ru ON ru.id = rtc.user_id
                        WHERE rtc.id = c.reply_to_comment_id
                        LIMIT 1
                    ) AS reply_to_author_name,
                    c.comment,
                    c.created_at,
                    c.updated_at,
                    COALESCE(u.name, u.username) AS author_name,
                    COALESCE(u.image, u.avatar_url) AS author_avatar_url,
                    (
                        SELECT COUNT(*)::int
                        FROM media_comment_likes l
                        WHERE l.comment_id = c.id
                    ) AS likes_count,
                    EXISTS (
                        SELECT 1
                        FROM media_comment_likes l
                        WHERE l.comment_id = c.id
                          AND l.user_id = ${req.userId ?? ''}
                    ) AS liked_by_viewer,
                    (
                        SELECT COUNT(*)::int
                        FROM media_comments rc
                        WHERE rc.parent_comment_id = c.id
                          AND rc.deleted_at IS NULL
                    ) AS replies_count
                FROM media_comments c
                JOIN "user" u ON u.id = c.user_id
                WHERE c.media_type = ${mediaType}
                  AND c.tmdb_id = ${tmdbId}
                  AND c.parent_comment_id IS NULL
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
                    c.parent_comment_id,
                    c.reply_to_comment_id,
                    (
                        SELECT COALESCE(ru.name, ru.username)
                        FROM media_comments rtc
                        JOIN "user" ru ON ru.id = rtc.user_id
                        WHERE rtc.id = c.reply_to_comment_id
                        LIMIT 1
                    ) AS reply_to_author_name,
                    c.comment,
                    c.created_at,
                    c.updated_at,
                    COALESCE(u.name, u.username) AS author_name,
                    COALESCE(u.image, u.avatar_url) AS author_avatar_url,
                    (
                        SELECT COUNT(*)::int
                        FROM media_comment_likes l
                        WHERE l.comment_id = c.id
                    ) AS likes_count,
                    EXISTS (
                        SELECT 1
                        FROM media_comment_likes l
                        WHERE l.comment_id = c.id
                          AND l.user_id = ${req.userId ?? ''}
                    ) AS liked_by_viewer,
                    (
                        SELECT COUNT(*)::int
                        FROM media_comments rc
                        WHERE rc.parent_comment_id = c.id
                          AND rc.deleted_at IS NULL
                    ) AS replies_count
                FROM media_comments c
                JOIN "user" u ON u.id = c.user_id
                WHERE c.media_type = ${mediaType}
                  AND c.tmdb_id = ${tmdbId}
                  AND c.parent_comment_id IS NULL
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

        const repliesByParent = new Map<string, ReviewComment[]>();

        await Promise.all(
            pageRows.map(async (row) => {
                const parentCommentId = String(row.id);
                const replyRows = await sql`
                    SELECT
                        c.id,
                        c.user_id,
                        c.media_type,
                        c.tmdb_id,
                        c.parent_comment_id,
                        c.reply_to_comment_id,
                        (
                            SELECT COALESCE(ru.name, ru.username)
                            FROM media_comments rtc
                            JOIN "user" ru ON ru.id = rtc.user_id
                            WHERE rtc.id = c.reply_to_comment_id
                            LIMIT 1
                        ) AS reply_to_author_name,
                        c.comment,
                        c.created_at,
                        c.updated_at,
                        COALESCE(u.name, u.username) AS author_name,
                        COALESCE(u.image, u.avatar_url) AS author_avatar_url,
                        (
                            SELECT COUNT(*)::int
                            FROM media_comment_likes l
                            WHERE l.comment_id = c.id
                        ) AS likes_count,
                        EXISTS (
                            SELECT 1
                            FROM media_comment_likes l
                            WHERE l.comment_id = c.id
                              AND l.user_id = ${req.userId ?? ''}
                        ) AS liked_by_viewer,
                        0::int AS replies_count
                    FROM media_comments c
                    JOIN "user" u ON u.id = c.user_id
                    WHERE c.parent_comment_id = ${parentCommentId}
                      AND c.deleted_at IS NULL
                    ORDER BY c.created_at ASC, c.id ASC
                `;

                repliesByParent.set(
                    parentCommentId,
                    replyRows.map((replyRow) => mapCommentRow(replyRow as RawCommentRow, req.userId, []))
                );
            })
        );

        const response: PaginatedCommentsResponse = {
            media: {
                mediaType,
                tmdbId,
            },
            comments: pageRows.map((row) => {
                const replies = repliesByParent.get(String(row.id)) ?? [];
                return mapCommentRow(row as RawCommentRow, req.userId, replies);
            }),
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

        await sql`
            INSERT INTO media_comments (id, user_id, media_type, tmdb_id, comment)
            VALUES (${id}, ${req.userId}, ${mediaType}, ${tmdbId}, ${bodyParsed.data.comment})
        `;

        const createdComment = await getCommentById(id, req.userId);
        if (!createdComment) {
            return res.status(500).json({ message: 'Failed to load created comment' });
        }

        res.status(201).json({ comment: createdComment });
    } catch (error) {
        next(error);
    }
};

export const createReply = async (req: Request, res: Response, next: NextFunction) => {
    if (!req.userId) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    try {
        const paramsParsed = commentIdParamSchema.safeParse(req.params);
        if (!paramsParsed.success) {
            return res.status(400).json({ message: 'Validation failed', errors: paramsParsed.error.issues });
        }

        const bodyParsed = createReplySchema.safeParse(req.body);
        if (!bodyParsed.success) {
            return res.status(400).json({ message: 'Validation failed', errors: bodyParsed.error.issues });
        }

        const { commentId } = paramsParsed.data;

        const parentRows = await sql`
            SELECT id, media_type, tmdb_id, parent_comment_id, deleted_at
            FROM media_comments
            WHERE id = ${commentId}
            LIMIT 1
        `;

        if (parentRows.length === 0 || parentRows[0].deleted_at) {
            return res.status(404).json({ message: 'Comment not found' });
        }

        const threadParentId = parentRows[0].parent_comment_id
            ? String(parentRows[0].parent_comment_id)
            : commentId;

        const id = generateId(21);

        await sql`
            INSERT INTO media_comments (
                id,
                user_id,
                media_type,
                tmdb_id,
                parent_comment_id,
                reply_to_comment_id,
                comment
            )
            VALUES (
                ${id},
                ${req.userId},
                ${parentRows[0].media_type},
                ${parentRows[0].tmdb_id},
                ${threadParentId},
                ${commentId},
                ${bodyParsed.data.comment}
            )
        `;

        const createdReply = await getCommentById(id, req.userId);
        if (!createdReply) {
            return res.status(500).json({ message: 'Failed to load created reply' });
        }

        res.status(201).json({ comment: createdReply });
    } catch (error) {
        next(error);
    }
};

export const updateComment = async (req: Request, res: Response, next: NextFunction) => {
    if (!req.userId) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    try {
        const paramsParsed = commentIdParamSchema.safeParse(req.params);
        if (!paramsParsed.success) {
            return res.status(400).json({ message: 'Validation failed', errors: paramsParsed.error.issues });
        }

        const bodyParsed = updateCommentSchema.safeParse(req.body);
        if (!bodyParsed.success) {
            return res.status(400).json({ message: 'Validation failed', errors: bodyParsed.error.issues });
        }

        const { commentId } = paramsParsed.data;

        const existingRows = await sql`
            SELECT id, user_id, parent_comment_id, deleted_at
            FROM media_comments
            WHERE id = ${commentId}
            LIMIT 1
        `;

        if (existingRows.length === 0 || existingRows[0].deleted_at) {
            return res.status(404).json({ message: 'Comment not found' });
        }

        const isAdmin = (req.user as { role?: string } | null | undefined)?.role === 'admin';
        const isOwner = String(existingRows[0].user_id) === req.userId;

        if (!isOwner && !isAdmin) {
            return res.status(403).json({ message: 'Forbidden: cannot edit this comment' });
        }

        await sql`
            UPDATE media_comments
            SET comment = ${bodyParsed.data.comment}, updated_at = CURRENT_TIMESTAMP
            WHERE id = ${commentId}
        `;

        const updatedComment = await getCommentById(commentId, req.userId);
        if (!updatedComment) {
            return res.status(404).json({ message: 'Comment not found' });
        }

        return res.status(200).json({ comment: updatedComment });
    } catch (error) {
        next(error);
    }
};

export const deleteComment = async (req: Request, res: Response, next: NextFunction) => {
    if (!req.userId) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    try {
        const paramsParsed = commentIdParamSchema.safeParse(req.params);
        if (!paramsParsed.success) {
            return res.status(400).json({ message: 'Validation failed', errors: paramsParsed.error.issues });
        }

        const bodyParsed = deleteCommentSchema.safeParse(req.body ?? {});
        if (!bodyParsed.success) {
            return res.status(400).json({ message: 'Validation failed', errors: bodyParsed.error.issues });
        }

        const { commentId } = paramsParsed.data;

        const existingRows = await sql`
            SELECT id, user_id, parent_comment_id, deleted_at
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

        if (!existing.parent_comment_id) {
            await sql`
                UPDATE media_comments
                SET
                    deleted_at = CURRENT_TIMESTAMP,
                    deleted_by_user_id = ${req.userId},
                    deletion_reason = 'Parent comment deleted',
                    updated_at = CURRENT_TIMESTAMP
                WHERE parent_comment_id = ${commentId}
                  AND deleted_at IS NULL
            `;
        }

        return res.status(204).send();
    } catch (error) {
        next(error);
    }
};

export const likeComment = async (req: Request, res: Response, next: NextFunction) => {
    if (!req.userId) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    try {
        const paramsParsed = commentIdParamSchema.safeParse(req.params);
        if (!paramsParsed.success) {
            return res.status(400).json({ message: 'Validation failed', errors: paramsParsed.error.issues });
        }

        const { commentId } = paramsParsed.data;

        const existingRows = await sql`
            SELECT id
            FROM media_comments
            WHERE id = ${commentId}
              AND deleted_at IS NULL
            LIMIT 1
        `;

        if (existingRows.length === 0) {
            return res.status(404).json({ message: 'Comment not found' });
        }

        await sql`
            INSERT INTO media_comment_likes (id, comment_id, user_id)
            VALUES (${generateId(21)}, ${commentId}, ${req.userId})
            ON CONFLICT (comment_id, user_id)
            DO NOTHING
        `;

        const likeSnapshot = await getCommentLikeSnapshot(commentId, req.userId);
        return res.status(200).json(likeSnapshot);
    } catch (error) {
        next(error);
    }
};

export const unlikeComment = async (req: Request, res: Response, next: NextFunction) => {
    if (!req.userId) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    try {
        const paramsParsed = commentIdParamSchema.safeParse(req.params);
        if (!paramsParsed.success) {
            return res.status(400).json({ message: 'Validation failed', errors: paramsParsed.error.issues });
        }

        const { commentId } = paramsParsed.data;

        const existingRows = await sql`
            SELECT id
            FROM media_comments
            WHERE id = ${commentId}
              AND deleted_at IS NULL
            LIMIT 1
        `;

        if (existingRows.length === 0) {
            return res.status(404).json({ message: 'Comment not found' });
        }

        await sql`
            DELETE FROM media_comment_likes
            WHERE comment_id = ${commentId}
              AND user_id = ${req.userId}
        `;

        const likeSnapshot = await getCommentLikeSnapshot(commentId, req.userId);
        return res.status(200).json(likeSnapshot);
    } catch (error) {
        next(error);
    }
};
