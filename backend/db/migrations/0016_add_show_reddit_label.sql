-- Add per-user toggle for showing Reddit recommendation label in UI.
-- Default true preserves current admin behavior (label visible) until each admin changes it.
ALTER TABLE "user"
ADD COLUMN IF NOT EXISTS "show_reddit_label" boolean NOT NULL DEFAULT true;
