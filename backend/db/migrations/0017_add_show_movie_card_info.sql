-- Add per-user toggle for showing title/year/rating overlay on movie cards.
-- Default false keeps cards clean unless a user opts in from Profile settings.
ALTER TABLE "user"
ADD COLUMN IF NOT EXISTS "show_movie_card_info" boolean NOT NULL DEFAULT false;
