ALTER TABLE media_comments
    ADD COLUMN IF NOT EXISTS reply_to_comment_id TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'media_comments_reply_to_comment_id_fkey'
    ) THEN
        ALTER TABLE media_comments
            ADD CONSTRAINT media_comments_reply_to_comment_id_fkey
            FOREIGN KEY (reply_to_comment_id)
            REFERENCES media_comments (id)
            ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_media_comments_reply_to_comment_id
    ON media_comments (reply_to_comment_id);
