import { afterAll, beforeAll, expect, test } from 'vitest';
import request from 'supertest';
import app from '../api/index.js';
import { sql } from '../lib/db.js';

const frontendOrigin = process.env.FRONTEND_URL || 'http://localhost:8080';
const suffix = Date.now();

const ownerUser = {
    id: `test_owner_${suffix}`,
    email: `owner_${suffix}@example.com`,
    name: 'Test Owner',
    role: 'user',
};

const otherUser = {
    id: `test_other_${suffix}`,
    email: `other_${suffix}@example.com`,
    name: 'Test Other',
    role: 'user',
};

const adminUser = {
    id: `test_admin_${suffix}`,
    email: `admin_${suffix}@example.com`,
    name: 'Test Admin',
    role: 'admin',
};

const mediaType = 'movie';
const tmdbId = 990000 + Math.floor(Math.random() * 1000);

const authed = (
    req: request.Test,
    user: { id: string; role: string },
    withOrigin = true
) => {
    req.set('x-test-user-id', user.id);
    req.set('x-test-user-role', user.role);

    if (withOrigin) {
        req.set('Origin', frontendOrigin);
    }

    return req;
};

beforeAll(async () => {
    await sql`
        INSERT INTO "user" (id, name, email, email_verified, role)
        VALUES
            (${ownerUser.id}, ${ownerUser.name}, ${ownerUser.email}, true, ${ownerUser.role}),
            (${otherUser.id}, ${otherUser.name}, ${otherUser.email}, true, ${otherUser.role}),
            (${adminUser.id}, ${adminUser.name}, ${adminUser.email}, true, ${adminUser.role})
    `;
});

afterAll(async () => {
    await sql`DELETE FROM media_ratings WHERE user_id IN (${ownerUser.id}, ${otherUser.id}, ${adminUser.id})`;
    await sql`DELETE FROM media_comments WHERE user_id IN (${ownerUser.id}, ${otherUser.id}, ${adminUser.id})`;
    await sql`DELETE FROM "user" WHERE id IN (${ownerUser.id}, ${otherUser.id}, ${adminUser.id})`;
});

test('blocks unauthenticated comment creation', async () => {
    const response = await request(app)
        .post(`/api/reviews/${mediaType}/${tmdbId}/comments`)
        .set('Origin', frontendOrigin)
        .send({ comment: 'Unauthed request' });

    expect(response.status).toBe(401);
});

test('enforces strict origin protection for writes', async () => {
    const response = await authed(
        request(app).put(`/api/reviews/${mediaType}/${tmdbId}/rating`).send({ rating: 8 }),
        ownerUser,
        false
    );

    expect(response.status).toBe(403);
});

test('validates rating boundaries', async () => {
    const response = await authed(
        request(app).put(`/api/reviews/${mediaType}/${tmdbId}/rating`).send({ rating: 11 }),
        ownerUser
    );

    expect(response.status).toBe(400);
});

test('keeps one rating per user per media via upsert constraint', async () => {
    const first = await authed(
        request(app).put(`/api/reviews/${mediaType}/${tmdbId}/rating`).send({ rating: 6 }),
        ownerUser
    );
    expect(first.status).toBe(200);

    const second = await authed(
        request(app).put(`/api/reviews/${mediaType}/${tmdbId}/rating`).send({ rating: 9 }),
        ownerUser
    );
    expect(second.status).toBe(200);

    const summary = await authed(
        request(app).get(`/api/reviews/${mediaType}/${tmdbId}/summary`),
        ownerUser
    );

    expect(summary.status).toBe(200);
    expect(summary.body.summary.ratingsCount).toBe(1);
    expect(summary.body.userRating).toBe(9);
});

test('supports replies and likes on review comments', async () => {
    const rootCommentResponse = await authed(
        request(app)
            .post(`/api/reviews/${mediaType}/${tmdbId}/comments`)
            .send({ comment: `Root comment ${Date.now()}` }),
        ownerUser
    );

    expect(rootCommentResponse.status).toBe(201);
    const rootCommentId = rootCommentResponse.body.comment.id as string;

    const replyResponse = await authed(
        request(app)
            .post(`/api/reviews/comments/${rootCommentId}/replies`)
            .send({ comment: `Reply comment ${Date.now()}` }),
        otherUser
    );

    expect(replyResponse.status).toBe(201);
    expect(replyResponse.body.comment.parentCommentId).toBe(rootCommentId);
    expect(replyResponse.body.comment.replyToCommentId).toBe(rootCommentId);

    const nestedReplyResponse = await authed(
        request(app)
            .post(`/api/reviews/comments/${replyResponse.body.comment.id}/replies`)
            .send({ comment: `Nested reply ${Date.now()}` }),
        adminUser
    );

    expect(nestedReplyResponse.status).toBe(201);
    expect(nestedReplyResponse.body.comment.parentCommentId).toBe(rootCommentId);
    expect(nestedReplyResponse.body.comment.replyToCommentId).toBe(replyResponse.body.comment.id);

    const likeRoot = await authed(
        request(app).put(`/api/reviews/comments/${rootCommentId}/likes`),
        ownerUser
    );

    expect(likeRoot.status).toBe(200);
    expect(likeRoot.body.likesCount).toBe(1);
    expect(likeRoot.body.likedByViewer).toBe(true);

    const likeReply = await authed(
        request(app).put(`/api/reviews/comments/${replyResponse.body.comment.id}/likes`),
        ownerUser
    );

    expect(likeReply.status).toBe(200);
    expect(likeReply.body.likesCount).toBe(1);

    const commentsList = await authed(
        request(app).get(`/api/reviews/${mediaType}/${tmdbId}/comments?limit=20`),
        ownerUser
    );

    expect(commentsList.status).toBe(200);

    const root = commentsList.body.comments.find((comment: { id: string }) => comment.id === rootCommentId);
    expect(root).toBeTruthy();
    expect(root.likesCount).toBe(1);
    expect(root.likedByViewer).toBe(true);
    expect(root.repliesCount).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(root.replies)).toBe(true);
    expect(root.replies.length).toBeGreaterThanOrEqual(2);

    const reply = root.replies.find((item: { id: string }) => item.id === replyResponse.body.comment.id);
    expect(reply).toBeTruthy();
    expect(reply.likesCount).toBe(1);
    expect(reply.likedByViewer).toBe(true);

    const nestedReply = root.replies.find((item: { id: string }) => item.id === nestedReplyResponse.body.comment.id);
    expect(nestedReply).toBeTruthy();
    expect(nestedReply.replyToCommentId).toBe(replyResponse.body.comment.id);

    const unlikeRoot = await authed(
        request(app).delete(`/api/reviews/comments/${rootCommentId}/likes`),
        ownerUser
    );

    expect(unlikeRoot.status).toBe(200);
    expect(unlikeRoot.body.likesCount).toBe(0);
    expect(unlikeRoot.body.likedByViewer).toBe(false);
});

test('enforces comment ownership and allows admin moderation delete', async () => {
    const createResponse = await authed(
        request(app)
            .post(`/api/reviews/${mediaType}/${tmdbId}/comments`)
            .send({ comment: `Owner comment ${Date.now()}` }),
        ownerUser
    );

    expect(createResponse.status).toBe(201);
    const commentId = createResponse.body.comment.id as string;

    const editByOther = await authed(
        request(app)
            .patch(`/api/reviews/comments/${commentId}`)
            .send({ comment: 'I should not be able to edit this' }),
        otherUser
    );

    expect(editByOther.status).toBe(403);

    const deleteByAdmin = await authed(
        request(app)
            .delete(`/api/reviews/comments/${commentId}`)
            .send({ reason: 'Moderation action' }),
        adminUser
    );

    expect(deleteByAdmin.status).toBe(204);

    const commentsList = await request(app).get(`/api/reviews/${mediaType}/${tmdbId}/comments?limit=20`);
    expect(commentsList.status).toBe(200);
    expect(commentsList.body.comments.some((comment: { id: string }) => comment.id === commentId)).toBe(false);
});
