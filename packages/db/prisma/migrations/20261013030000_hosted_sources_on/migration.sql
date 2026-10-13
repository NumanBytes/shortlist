-- Discovery Milestone 2 (docs/discovery.md §9.3): JazzHR, Zoho Recruit and OpenCATS now have
-- adapters. Their rows were seeded as planned sources whose config is just the page URL — the
-- same shape the adapters take — so they only need switching on. The user asked for jobs from
-- their own company list "at every cost" (2026-10-12).

-- Tintash's careers page links out to its Zoho site; the adapter needs the Zoho address.
UPDATE "JobSource"
SET "config" = '{"provider": "zohorecruit", "url": "https://tintash.zohorecruit.com/jobs/new-openings"}'::jsonb
WHERE "key" = 'zohorecruit:tintash' AND "config"->>'url' = 'https://games.tintash.com/careers/';

-- SlashNext stays off: its Zoho careers site answers with an error page (2026-10-13).
UPDATE "JobSource"
SET "isEnabled" = true
WHERE "config"->>'provider' IN ('jazzhr', 'zohorecruit', 'opencats')
  AND "key" <> 'zohorecruit:slashnext';
