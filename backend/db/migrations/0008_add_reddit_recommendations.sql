-- Add Reddit Recommendations table for storing scraped movie recommendations from Reddit
-- This table stores movie/TV mentions found in subreddits like r/MovieSuggestions

-- Drop existing table if it exists (to handle schema changes)
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
CREATE INDEX IF NOT EXISTS idx_reddit_recommendations_tmdb_id ON reddit_recommendations(tmdb_id);
CREATE INDEX IF NOT EXISTS idx_reddit_recommendations_media_type ON reddit_recommendations(media_type);
CREATE INDEX IF NOT EXISTS idx_reddit_recommendations_subreddit ON reddit_recommendations(subreddit);

-- Create unique constraint on title to allow upserts
CREATE UNIQUE INDEX IF NOT EXISTS reddit_recommendations_title_key ON reddit_recommendations(title);
