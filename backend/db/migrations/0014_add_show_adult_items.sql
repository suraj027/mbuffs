-- Add show_adult_items column to user table.
-- NOTE: initial default was true. Migration 0015 corrects the default to false
-- and backfills existing rows.
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "show_adult_items" boolean NOT NULL DEFAULT true;
