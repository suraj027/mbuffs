import { afterAll, beforeAll, expect, test } from 'vitest';
import request from 'supertest';
import app from '../api/index.js';
import { sql } from '../lib/db.js';
import { generateId } from '../lib/utils.js';

const frontendOrigin = process.env.FRONTEND_URL || 'http://localhost:8080';
const suffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;

// --- Test users ---
const owner = {
    id: `bulk_owner_${suffix}`,
    email: `bulk_owner_${suffix}@example.com`,
    name: 'Bulk Owner',
    role: 'user',
};

const editor = {
    id: `bulk_editor_${suffix}`,
    email: `bulk_editor_${suffix}@example.com`,
    name: 'Bulk Editor',
    role: 'user',
};

const viewer = {
    id: `bulk_viewer_${suffix}`,
    email: `bulk_viewer_${suffix}@example.com`,
    name: 'Bulk Viewer',
    role: 'user',
};

const outsider = {
    id: `bulk_outsider_${suffix}`,
    email: `bulk_outsider_${suffix}@example.com`,
    name: 'Bulk Outsider',
    role: 'user',
};

// --- Test collection IDs ---
let sourceCollectionId: string;
let targetCollectionId: string;
let otherTargetCollectionId: string;

// --- Test movie IDs (fake TMDB ids; no metadata fetched) ---
const movieIds = ['100001', '100002', '100003', '100004'];
const tvIds = ['200001tv', '200002tv'];

const authed = (
    req: request.Test,
    user: { id: string; role: string },
    withOrigin = true,
) => {
    req.set('x-test-user-id', user.id);
    req.set('x-test-user-role', user.role);
    if (withOrigin) {
        req.set('Origin', frontendOrigin);
    }
    return req;
};

beforeAll(async () => {
    // Create test users
    await sql`
        INSERT INTO "user" (id, name, email, email_verified, role)
        VALUES
            (${owner.id}, ${owner.name}, ${owner.email}, true, ${owner.role}),
            (${editor.id}, ${editor.name}, ${editor.email}, true, ${editor.role}),
            (${viewer.id}, ${viewer.name}, ${viewer.email}, true, ${viewer.role}),
            (${outsider.id}, ${outsider.name}, ${outsider.email}, true, ${outsider.role})
    `;

    // Create source collection (owned by `owner`)
    sourceCollectionId = generateId(21);
    await sql`
        INSERT INTO collections (id, name, description, owner_id, is_public, shareable_id, is_system)
        VALUES (${sourceCollectionId}, 'Bulk Source', 'Test source collection', ${owner.id}, false, ${generateId(12)}, false)
    `;

    // Create target collection (owned by `owner`)
    targetCollectionId = generateId(21);
    await sql`
        INSERT INTO collections (id, name, description, owner_id, is_public, shareable_id, is_system)
        VALUES (${targetCollectionId}, 'Bulk Target', 'Test target collection', ${owner.id}, false, ${generateId(12)}, false)
    `;

    // Create another target (owned by `owner`)
    otherTargetCollectionId = generateId(21);
    await sql`
        INSERT INTO collections (id, name, description, owner_id, is_public, shareable_id, is_system)
        VALUES (${otherTargetCollectionId}, 'Bulk Target 2', 'Another target', ${owner.id}, false, ${generateId(12)}, false)
    `;

    // Add `editor` as edit collaborator on the source collection
    await sql`
        INSERT INTO collection_collaborators (id, collection_id, user_id, permission)
        VALUES (${generateId(21)}, ${sourceCollectionId}, ${editor.id}, 'edit')
    `;

    // Add `editor` as edit collaborator on the target collection (so move/copy to it works)
    await sql`
        INSERT INTO collection_collaborators (id, collection_id, user_id, permission)
        VALUES (${generateId(21)}, ${targetCollectionId}, ${editor.id}, 'edit')
    `;

    // Add `viewer` as view collaborator on the source collection
    await sql`
        INSERT INTO collection_collaborators (id, collection_id, user_id, permission)
        VALUES (${generateId(21)}, ${sourceCollectionId}, ${viewer.id}, 'view')
    `;

    // Add items to the source collection:
    //   - owner added movies 100001, 100002, 100003
    //   - editor added movie 100004 and TV 200001tv
    //   - owner added TV 200002tv
    const entries = [
        { id: generateId(21), movieId: movieIds[0], addedBy: owner.id, isMovie: true },
        { id: generateId(21), movieId: movieIds[1], addedBy: owner.id, isMovie: true },
        { id: generateId(21), movieId: movieIds[2], addedBy: owner.id, isMovie: true },
        { id: generateId(21), movieId: movieIds[3], addedBy: editor.id, isMovie: true },
        { id: generateId(21), movieId: tvIds[0], addedBy: editor.id, isMovie: false },
        { id: generateId(21), movieId: tvIds[1], addedBy: owner.id, isMovie: false },
    ];

    for (const entry of entries) {
        await sql`
            INSERT INTO collection_movies (id, collection_id, movie_id, added_by_user_id, is_movie)
            VALUES (${entry.id}, ${sourceCollectionId}, ${entry.movieId}, ${entry.addedBy}, ${entry.isMovie})
        `;
    }

    // Add one movie to the target collection so we can test duplicate-skip on copy
    await sql`
        INSERT INTO collection_movies (id, collection_id, movie_id, added_by_user_id, is_movie)
        VALUES (${generateId(21)}, ${targetCollectionId}, ${movieIds[0]}, ${owner.id}, true)
    `;
});

afterAll(async () => {
    // Clean up in dependency order
    await sql`DELETE FROM collection_movies WHERE collection_id IN (${sourceCollectionId}, ${targetCollectionId}, ${otherTargetCollectionId})`;
    await sql`DELETE FROM collection_collaborators WHERE collection_id IN (${sourceCollectionId}, ${targetCollectionId})`;
    await sql`DELETE FROM collections WHERE id IN (${sourceCollectionId}, ${targetCollectionId}, ${otherTargetCollectionId})`;
    await sql`DELETE FROM "user" WHERE id IN (${owner.id}, ${editor.id}, ${viewer.id}, ${outsider.id})`;
});

// ---------------------------------------------------------------------------
// COPY
// ---------------------------------------------------------------------------

test('owner can copy items to another collection (duplicates skipped)', async () => {
    // Copy movies 100001 (already in target) and 100002 (not in target)
    const res = await authed(
        request(app)
            .post(`/api/collections/${sourceCollectionId}/movies/bulk`)
            .send({
                action: 'copy',
                movieIds: [movieIds[0], movieIds[1]],
                targetCollectionId,
            }),
        owner,
    );

    expect(res.status).toBe(200);
    expect(res.body.action).toBe('copy');
    expect(res.body.addedCount).toBe(1); // only 100002 was new
    expect(res.body.skippedCount).toBe(1); // 100001 already there
    expect(res.body.removedCount).toBe(0); // copy doesn't remove

    // Verify source still has both items
    const sourceItems = await sql`
        SELECT movie_id FROM collection_movies
        WHERE collection_id = ${sourceCollectionId} AND movie_id = ANY(${[movieIds[0], movieIds[1]]}::text[])
    `;
    expect(sourceItems.length).toBe(2);
});

test('copy includes TV show ids with "tv" suffix', async () => {
    const res = await authed(
        request(app)
            .post(`/api/collections/${sourceCollectionId}/movies/bulk`)
            .send({
                action: 'copy',
                movieIds: [tvIds[1]],
                targetCollectionId: otherTargetCollectionId,
            }),
        owner,
    );

    expect(res.status).toBe(200);
    expect(res.body.addedCount).toBe(1);
    expect(res.body.skippedCount).toBe(0);
});

test('viewer can copy from a collection they can view', async () => {
    const res = await authed(
        request(app)
            .post(`/api/collections/${sourceCollectionId}/movies/bulk`)
            .send({
                action: 'copy',
                movieIds: [movieIds[2]],
                targetCollectionId: otherTargetCollectionId,
            }),
        viewer,
    );

    // Viewer has view permission on source, and no permission on target → should fail on target
    expect(res.status).toBe(403);
});

test('outsider cannot copy from a private collection', async () => {
    const res = await authed(
        request(app)
            .post(`/api/collections/${sourceCollectionId}/movies/bulk`)
            .send({
                action: 'copy',
                movieIds: [movieIds[2]],
                targetCollectionId: otherTargetCollectionId,
            }),
        outsider,
    );

    expect(res.status).toBe(403);
});

test('copy rejects when source equals target', async () => {
    const res = await authed(
        request(app)
            .post(`/api/collections/${sourceCollectionId}/movies/bulk`)
            .send({
                action: 'copy',
                movieIds: [movieIds[2]],
                targetCollectionId: sourceCollectionId,
            }),
        owner,
    );

    expect(res.status).toBe(400);
});

// ---------------------------------------------------------------------------
// MOVE
// ---------------------------------------------------------------------------

test('owner can move items to another collection', async () => {
    // Move movie 100003 (owner added, not yet in otherTarget) to otherTarget
    const res = await authed(
        request(app)
            .post(`/api/collections/${sourceCollectionId}/movies/bulk`)
            .send({
                action: 'move',
                movieIds: [movieIds[2]],
                targetCollectionId: otherTargetCollectionId,
            }),
        owner,
    );

    expect(res.status).toBe(200);
    expect(res.body.action).toBe('move');
    expect(res.body.addedCount).toBe(1);
    expect(res.body.removedCount).toBe(1);

    // Verify removed from source
    const sourceCheck = await sql`
        SELECT 1 FROM collection_movies
        WHERE collection_id = ${sourceCollectionId} AND movie_id = ${movieIds[2]}
    `;
    expect(sourceCheck.length).toBe(0);

    // Verify present in target
    const targetCheck = await sql`
        SELECT 1 FROM collection_movies
        WHERE collection_id = ${otherTargetCollectionId} AND movie_id = ${movieIds[2]}
    `;
    expect(targetCheck.length).toBe(1);
});

test('editor can move items they added', async () => {
    // Editor added movie 100004
    const res = await authed(
        request(app)
            .post(`/api/collections/${sourceCollectionId}/movies/bulk`)
            .send({
                action: 'move',
                movieIds: [movieIds[3]],
                targetCollectionId,
            }),
        editor,
    );

    expect(res.status).toBe(200);
    expect(res.body.addedCount).toBe(1);
    expect(res.body.removedCount).toBe(1);
});

test('editor cannot move items added by someone else', async () => {
    // Editor tries to move movie 100001 (added by owner) to target (editor has edit on target)
    const res = await authed(
        request(app)
            .post(`/api/collections/${sourceCollectionId}/movies/bulk`)
            .send({
                action: 'move',
                movieIds: [movieIds[0]],
                targetCollectionId,
            }),
        editor,
    );

    expect(res.status).toBe(403);
    expect(res.body.message).toContain('you added');
});

test('viewer cannot move items', async () => {
    const res = await authed(
        request(app)
            .post(`/api/collections/${sourceCollectionId}/movies/bulk`)
            .send({
                action: 'move',
                movieIds: [movieIds[2]],
                targetCollectionId: otherTargetCollectionId,
            }),
        viewer,
    );

    expect(res.status).toBe(403);
});

test('move with non-existent items returns 404', async () => {
    const res = await authed(
        request(app)
            .post(`/api/collections/${sourceCollectionId}/movies/bulk`)
            .send({
                action: 'move',
                movieIds: ['999999'],
                targetCollectionId,
            }),
        owner,
    );

    expect(res.status).toBe(404);
});

// ---------------------------------------------------------------------------
// REMOVE
// ---------------------------------------------------------------------------

test('owner can remove items from collection', async () => {
    // Remove movie 100002 from source
    const res = await authed(
        request(app)
            .post(`/api/collections/${sourceCollectionId}/movies/bulk`)
            .send({
                action: 'remove',
                movieIds: [movieIds[1]],
            }),
        owner,
    );

    expect(res.status).toBe(200);
    expect(res.body.action).toBe('remove');
    expect(res.body.removedCount).toBe(1);
    expect(res.body.addedCount).toBe(0);

    // Verify removed from source
    const check = await sql`
        SELECT 1 FROM collection_movies
        WHERE collection_id = ${sourceCollectionId} AND movie_id = ${movieIds[1]}
    `;
    expect(check.length).toBe(0);
});

test('editor can remove items they added', async () => {
    // Editor added TV 200001tv — still in source
    const res = await authed(
        request(app)
            .post(`/api/collections/${sourceCollectionId}/movies/bulk`)
            .send({
                action: 'remove',
                movieIds: [tvIds[0]],
            }),
        editor,
    );

    expect(res.status).toBe(200);
    expect(res.body.removedCount).toBe(1);
});

test('editor cannot remove items added by someone else', async () => {
    // Editor tries to remove movie 100001 (added by owner, still in source)
    const res = await authed(
        request(app)
            .post(`/api/collections/${sourceCollectionId}/movies/bulk`)
            .send({
                action: 'remove',
                movieIds: [movieIds[0]],
            }),
        editor,
    );

    expect(res.status).toBe(403);
    expect(res.body.message).toContain('you added');
});

test('viewer cannot remove items', async () => {
    const res = await authed(
        request(app)
            .post(`/api/collections/${sourceCollectionId}/movies/bulk`)
            .send({
                action: 'remove',
                movieIds: [movieIds[2]],
            }),
        viewer,
    );

    expect(res.status).toBe(403);
});

test('outsider cannot remove items from a private collection', async () => {
    const res = await authed(
        request(app)
            .post(`/api/collections/${sourceCollectionId}/movies/bulk`)
            .send({
                action: 'remove',
                movieIds: [movieIds[2]],
            }),
        outsider,
    );

    expect(res.status).toBe(403);
});

test('remove does not require targetCollectionId', async () => {
    // Even if targetCollectionId is omitted, remove should work
    const res = await authed(
        request(app)
            .post(`/api/collections/${sourceCollectionId}/movies/bulk`)
            .send({
                action: 'remove',
                movieIds: [movieIds[0]],
            }),
        owner,
    );

    expect(res.status).toBe(200);
    expect(res.body.removedCount).toBe(1);
});

// ---------------------------------------------------------------------------
// VALIDATION
// ---------------------------------------------------------------------------

test('rejects empty movieIds array', async () => {
    const res = await authed(
        request(app)
            .post(`/api/collections/${sourceCollectionId}/movies/bulk`)
            .send({
                action: 'copy',
                movieIds: [],
                targetCollectionId,
            }),
        owner,
    );

    expect(res.status).toBe(400);
});

test('rejects unknown action', async () => {
    const res = await authed(
        request(app)
            .post(`/api/collections/${sourceCollectionId}/movies/bulk`)
            .send({
                action: 'delete',
                movieIds: [movieIds[0]],
                targetCollectionId,
            }),
        owner,
    );

    expect(res.status).toBe(400);
});

test('rejects copy without targetCollectionId', async () => {
    const res = await authed(
        request(app)
            .post(`/api/collections/${sourceCollectionId}/movies/bulk`)
            .send({
                action: 'copy',
                movieIds: [movieIds[0]],
            }),
        owner,
    );

    expect(res.status).toBe(400);
});

test('rejects unauthenticated requests', async () => {
    const res = await request(app)
        .post(`/api/collections/${sourceCollectionId}/movies/bulk`)
        .set('Origin', frontendOrigin)
        .send({
            action: 'remove',
            movieIds: [movieIds[0]],
        });

    expect(res.status).toBe(401);
});

// ---------------------------------------------------------------------------
// BATCH / MULTI-ITEM
// ---------------------------------------------------------------------------

test('owner can remove multiple items in one request', async () => {
    // Re-add items first so we have something to remove
    await sql`
        INSERT INTO collection_movies (id, collection_id, movie_id, added_by_user_id, is_movie)
        VALUES
            (${generateId(21)}, ${sourceCollectionId}, '300001', ${owner.id}, true),
            (${generateId(21)}, ${sourceCollectionId}, '300002', ${owner.id}, true),
            (${generateId(21)}, ${sourceCollectionId}, '300003tv', ${owner.id}, false)
    `;

    const res = await authed(
        request(app)
            .post(`/api/collections/${sourceCollectionId}/movies/bulk`)
            .send({
                action: 'remove',
                movieIds: ['300001', '300002', '300003tv'],
            }),
        owner,
    );

    expect(res.status).toBe(200);
    expect(res.body.removedCount).toBe(3);
});

test('move skips items already in target but still removes from source', async () => {
    // Add a fresh item to source
    await sql`
        INSERT INTO collection_movies (id, collection_id, movie_id, added_by_user_id, is_movie)
        VALUES (${generateId(21)}, ${sourceCollectionId}, '400001', ${owner.id}, true)
    `;

    // Also add it to target so it's a duplicate
    await sql`
        INSERT INTO collection_movies (id, collection_id, movie_id, added_by_user_id, is_movie)
        VALUES (${generateId(21)}, ${targetCollectionId}, '400001', ${owner.id}, true)
    `;

    const res = await authed(
        request(app)
            .post(`/api/collections/${sourceCollectionId}/movies/bulk`)
            .send({
                action: 'move',
                movieIds: ['400001'],
                targetCollectionId,
            }),
        owner,
    );

    expect(res.status).toBe(200);
    expect(res.body.addedCount).toBe(0); // already in target
    expect(res.body.skippedCount).toBe(1);
    expect(res.body.removedCount).toBe(1); // still removed from source

    // Verify removed from source
    const sourceCheck = await sql`
        SELECT 1 FROM collection_movies
        WHERE collection_id = ${sourceCollectionId} AND movie_id = '400001'
    `;
    expect(sourceCheck.length).toBe(0);

    // Verify still in target (only one copy)
    const targetCheck = await sql`
        SELECT movie_id FROM collection_movies
        WHERE collection_id = ${targetCollectionId} AND movie_id = '400001'
    `;
    expect(targetCheck.length).toBe(1);
});
