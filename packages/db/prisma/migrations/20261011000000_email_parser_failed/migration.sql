-- A code parser that found nothing (or threw) and handed the email to the model is now a
-- flag, not a substring of the free-text note (code review 2026-10-11).
ALTER TABLE "EmailMessage" ADD COLUMN "parserFailed" BOOLEAN NOT NULL DEFAULT false;

-- Backfill from the notes the worker wrote until now ("<Portal> parser found no jobs …",
-- "<Portal> parser failed (…) …").
UPDATE "EmailMessage" SET "parserFailed" = true WHERE "note" LIKE '% parser found no jobs%' OR "note" LIKE '% parser failed (%';
