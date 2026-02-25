-- Add recommendation snapshot cache table

CREATE TABLE IF NOT EXISTS "recommendation_cache" (
    "id" text PRIMARY KEY NOT NULL,
    "user_id" text NOT NULL,
    "cache_key" text NOT NULL,
    "payload_json" text NOT NULL,
    "cache_version" text DEFAULT 'v1' NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recommendation_cache_user_cache_key') THEN
        ALTER TABLE "recommendation_cache"
            ADD CONSTRAINT "recommendation_cache_user_cache_key" UNIQUE ("user_id", "cache_key");
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recommendation_cache_user_id_fkey') THEN
        ALTER TABLE "recommendation_cache"
            ADD CONSTRAINT "recommendation_cache_user_id_fkey"
            FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_recommendation_cache_user_id" ON "recommendation_cache" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "idx_recommendation_cache_expires_at" ON "recommendation_cache" USING btree ("expires_at");
