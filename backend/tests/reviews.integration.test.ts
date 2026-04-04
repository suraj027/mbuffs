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
