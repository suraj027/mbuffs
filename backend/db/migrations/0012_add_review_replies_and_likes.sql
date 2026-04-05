ALTER TABLE media_comments
    ADD COLUMN IF NOT EXISTS parent_comment_id TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'media_comments_parent_comment_id_fkey'
    ) THEN
        ALTER TABLE media_comments
            ADD CONSTRAINT media_comments_parent_comment_id_fkey
            FOREIGN KEY (parent_comment_id)
            REFERENCES media_comments (id)
            ON DELETE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'media_comments_parent_not_self_check'
    ) THEN
        ALTER TABLE media_comments
            ADD CONSTRAINT media_comments_parent_not_self_check
            CHECK (parent_comment_id IS NULL OR parent_comment_id <> id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_media_comments_parent_comment_id
    ON media_comments (parent_comment_id);

CREATE TABLE IF NOT EXISTS media_comment_likes (
    id TEXT PRIMARY KEY,
    comment_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT media_comment_likes_comment_id_fkey
        FOREIGN KEY (comment_id)
        REFERENCES media_comments (id)
        ON DELETE CASCADE,
    CONSTRAINT media_comment_likes_user_id_fkey
        FOREIGN KEY (user_id)
        REFERENCES "user" (id)
        ON DELETE CASCADE,
    CONSTRAINT media_comment_likes_comment_user_unique
        UNIQUE (comment_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_media_comment_likes_comment_id
    ON media_comment_likes (comment_id);

CREATE INDEX IF NOT EXISTS idx_media_comment_likes_user_id
    ON media_comment_likes (user_id);
