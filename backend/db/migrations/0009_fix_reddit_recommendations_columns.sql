-- Fix Reddit Recommendations table column types (TEXT -> INTEGER for counts/scores)

-- Drop existing table and recreate with correct types
DROP TABLE IF EXISTS reddit_recommendations;

CREATE TABLE reddit_recommendations (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    tmdb_id TEXT,
    media_type TEXT NOT NULL DEFAULT 'movie',
    subreddit TEXT NOT NULL,
    post_id TEXT NOT NULL,
    post_title TEXT,
    mention_count INTEGER DEFAULT 1 NOT NULL,
    total_score INTEGER DEFAULT 0 NOT NULL,
    sentiment TEXT,
    genres TEXT,
    scraped_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for efficient querying
CREATE INDEX idx_reddit_recommendations_tmdb_id ON reddit_recommendations(tmdb_id);
CREATE INDEX idx_reddit_recommendations_media_type ON reddit_recommendations(media_type);
CREATE INDEX idx_reddit_recommendations_subreddit ON reddit_recommendations(subreddit);

-- Create unique constraint on title to allow upserts
CREATE UNIQUE INDEX reddit_recommendations_title_key ON reddit_recommendations(title);
