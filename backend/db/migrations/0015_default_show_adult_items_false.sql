-- Correct the show_adult_items default to false (hide adult items unless the user opts in).
-- Also backfills rows created under migration 0014's DEFAULT true, which went out before
-- any UI existed for users to set the preference.
ALTER TABLE "user" ALTER COLUMN "show_adult_items" SET DEFAULT false;
UPDATE "user" SET "show_adult_items" = false WHERE "show_adult_items" = true;
