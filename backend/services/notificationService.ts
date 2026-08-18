import { sql } from '../lib/db.js';
import { generateId } from '../lib/utils.js';
import webpush from 'web-push';

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:noreply@mbuffs.app';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

export interface NotificationRow {
    id: string;
    recipient_id: string;
    sender_id: string | null;
    type: string;
    payload: string;
    is_read: boolean;
    created_at: string;
    read_at: string | null;
    sender_name: string | null;
    sender_avatar_url: string | null;
}

interface PushPayload {
    title: string;
    body: string;
    icon?: string;
    url?: string;
    tag?: string;
}

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

function buildPushPayload(
    type: string,
    id: string,
    senderName: string,
    payload: Record<string, string>
): PushPayload {
    const IMAGE_BASE_URL = 'https://image.tmdb.org/t/p';

    switch (type) {
        case 'collection_item_added': {
            const collectionName = (payload.collection_name as string) || 'a collection';
            const title = (payload.title as string) || '';
            return {
                title: `${senderName} added to "${collectionName}"`,
                body: title || 'Check it out!',
                icon: payload.poster_path
                    ? `${IMAGE_BASE_URL}/w92${payload.poster_path}`
                    : undefined,
                url: payload.collection_id
                    ? `/collection/${payload.collection_id}`
                    : undefined,
                tag: `collection-item-${id}`,
            };
        }
        case 'media_share':
        default: {
            return {
                title: `${senderName} shared with you`,
                body: (payload.title as string) || 'Check it out!',
                icon: payload.poster_path
                    ? `${IMAGE_BASE_URL}/w92${payload.poster_path}`
                    : undefined,
                url: payload.media_type === 'person'
                    ? `/person/${payload.tmdb_id}`
                    : `/media/${payload.media_type}/${payload.tmdb_id}`,
                tag: `share-${id}`,
            };
        }
    }
}

export async function createNotification(params: {
    recipientId: string;
    senderId: string | null;
    type: string;
    payload: Record<string, unknown>;
}): Promise<string> {
    const id = generateId(21);
    const payloadJson = JSON.stringify(params.payload);

    await sql`
        INSERT INTO notifications (id, recipient_id, sender_id, type, payload)
        VALUES (${id}, ${params.recipientId}, ${params.senderId}, ${params.type}, ${payloadJson})
    `;

    if (params.senderId) {
        try {
            const senderResult = await sql`
                SELECT COALESCE(username, name) as name FROM "user" WHERE id = ${params.senderId}
            `;
            const senderName = senderResult[0]?.name || 'Someone';
            const payload = params.payload as Record<string, string>;

            const pushPayload = buildPushPayload(params.type, id, senderName, payload);

            sendPushToUser(params.recipientId, pushPayload).catch((err) => {
                console.error('[notifications] Push delivery failed:', err);
            });
        } catch (err) {
            console.error('[notifications] Failed to build push payload:', err);
        }
    }

    return id;
}

export async function getNotificationsForUser(
    userId: string,
    options?: { limit?: number; cursor?: string }
): Promise<{ notifications: NotificationRow[]; nextCursor: string | null; hasMore: boolean }> {
    const limit = options?.limit ?? 20;
    const fetchLimit = limit + 1;

    const decodedCursor = options?.cursor ? decodeCursor(options.cursor) : null;

    let rows: NotificationRow[];

    if (decodedCursor) {
        rows = (await sql`
            SELECT n.id, n.recipient_id, n.sender_id, n.type, n.payload,
                   n.is_read, n.created_at, n.read_at,
                   COALESCE(u.username, u.name) as sender_name,
                   COALESCE(u.image, u.avatar_url) as sender_avatar_url
            FROM notifications n
            LEFT JOIN "user" u ON n.sender_id = u.id
            WHERE n.recipient_id = ${userId}
              AND (n.created_at, n.id) < (${decodedCursor.createdAt}, ${decodedCursor.id})
            ORDER BY n.created_at DESC, n.id DESC
            LIMIT ${fetchLimit}
        `) as NotificationRow[];
    } else {
        rows = (await sql`
            SELECT n.id, n.recipient_id, n.sender_id, n.type, n.payload,
                   n.is_read, n.created_at, n.read_at,
                   COALESCE(u.username, u.name) as sender_name,
                   COALESCE(u.image, u.avatar_url) as sender_avatar_url
            FROM notifications n
            LEFT JOIN "user" u ON n.sender_id = u.id
            WHERE n.recipient_id = ${userId}
            ORDER BY n.created_at DESC, n.id DESC
            LIMIT ${fetchLimit}
        `) as NotificationRow[];
    }

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const lastItem = pageRows[pageRows.length - 1];
    const nextCursor = hasMore && lastItem
        ? encodeCursor(String(lastItem.created_at), String(lastItem.id))
        : null;

    return { notifications: pageRows, nextCursor, hasMore };
}

export async function getUnreadCount(userId: string): Promise<number> {
    const result = await sql`
        SELECT COUNT(*)::int as count
        FROM notifications
        WHERE recipient_id = ${userId} AND is_read = FALSE
    `;
    return result[0]?.count ?? 0;
}

export async function markAsRead(notificationId: string, userId: string): Promise<boolean> {
    const result = await sql`
        UPDATE notifications
        SET is_read = TRUE, read_at = CURRENT_TIMESTAMP
        WHERE id = ${notificationId} AND recipient_id = ${userId} AND is_read = FALSE
        RETURNING id
    `;
    return result.length > 0;
}

export async function markAllAsRead(userId: string): Promise<number> {
    const result = await sql`
        UPDATE notifications
        SET is_read = TRUE, read_at = CURRENT_TIMESTAMP
        WHERE recipient_id = ${userId} AND is_read = FALSE
        RETURNING id
    `;
    return result.length;
}

export async function deleteNotification(notificationId: string, userId: string): Promise<boolean> {
    const result = await sql`
        DELETE FROM notifications
        WHERE id = ${notificationId} AND recipient_id = ${userId}
        RETURNING id
    `;
    return result.length > 0;
}

export async function clearAllNotifications(userId: string): Promise<number> {
    const result = await sql`
        DELETE FROM notifications
        WHERE recipient_id = ${userId}
        RETURNING id
    `;
    return result.length;
}

export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
        return;
    }

    const subscriptions = (await sql`
        SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ${userId}
    `) as Array<{ id: string; endpoint: string; p256dh: string; auth: string }>;

    if (subscriptions.length === 0) return;

    const payloadString = JSON.stringify(payload);
    const staleIds: string[] = [];

    await Promise.allSettled(
        subscriptions.map(async (sub) => {
            try {
                await webpush.sendNotification(
                    {
                        endpoint: sub.endpoint,
                        keys: { p256dh: sub.p256dh, auth: sub.auth },
                    },
                    payloadString
                );
            } catch (err: unknown) {
                const pushErr = err as { statusCode?: number };
                if (pushErr.statusCode === 410 || pushErr.statusCode === 404) {
                    staleIds.push(sub.id);
                } else {
                    console.error(`[push] Failed to send to ${sub.endpoint.slice(0, 50)}...`, err);
                }
            }
        })
    );

    if (staleIds.length > 0) {
        await sql`DELETE FROM push_subscriptions WHERE id = ANY(${staleIds})`;
    }
}

export async function savePushSubscription(
    userId: string,
    endpoint: string,
    p256dh: string,
    auth: string
): Promise<void> {
    const id = generateId(21);
    await sql`
        INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth)
        VALUES (${id}, ${userId}, ${endpoint}, ${p256dh}, ${auth})
        ON CONFLICT (endpoint) DO UPDATE SET user_id = ${userId}, p256dh = ${p256dh}, auth = ${auth}
    `;
}

export async function deletePushSubscription(endpoint: string): Promise<void> {
    await sql`DELETE FROM push_subscriptions WHERE endpoint = ${endpoint}`;
}
