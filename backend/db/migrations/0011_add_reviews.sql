CREATE TABLE IF NOT EXISTS media_ratings (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    media_type TEXT NOT NULL,
    tmdb_id INTEGER NOT NULL,
    rating INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT media_ratings_user_id_fkey
        FOREIGN KEY (user_id)
        REFERENCES "user" (id)
        ON DELETE CASCADE,
    CONSTRAINT media_ratings_media_type_check
        CHECK (media_type IN ('movie', 'tv')),
    CONSTRAINT media_ratings_rating_check
        CHECK (rating >= 1 AND rating <= 10),
    CONSTRAINT media_ratings_user_media_unique
        UNIQUE (user_id, media_type, tmdb_id)
);

CREATE INDEX IF NOT EXISTS idx_media_ratings_media
    ON media_ratings (media_type, tmdb_id);

CREATE INDEX IF NOT EXISTS idx_media_ratings_user_id
    ON media_ratings (user_id);

CREATE TABLE IF NOT EXISTS media_comments (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    media_type TEXT NOT NULL,
    tmdb_id INTEGER NOT NULL,
    comment TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMPTZ,
    deleted_by_user_id TEXT,
    deletion_reason TEXT,
    CONSTRAINT media_comments_user_id_fkey
        FOREIGN KEY (user_id)
        REFERENCES "user" (id)
        ON DELETE CASCADE,
    CONSTRAINT media_comments_deleted_by_user_id_fkey
        FOREIGN KEY (deleted_by_user_id)
        REFERENCES "user" (id)
        ON DELETE SET NULL,
    CONSTRAINT media_comments_media_type_check
        CHECK (media_type IN ('movie', 'tv')),
    CONSTRAINT media_comments_comment_length_check
        CHECK (char_length(btrim(comment)) BETWEEN 1 AND 2000)
);

CREATE INDEX IF NOT EXISTS idx_media_comments_media_created_desc
    ON media_comments (media_type, tmdb_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_media_comments_user_id
    ON media_comments (user_id);

CREATE INDEX IF NOT EXISTS idx_media_comments_deleted_at
    ON media_comments (deleted_at);
