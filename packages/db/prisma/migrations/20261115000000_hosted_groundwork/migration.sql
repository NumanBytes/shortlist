-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "PaperSize" AS ENUM ('LETTER', 'A4');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "paperSize" "PaperSize" NOT NULL DEFAULT 'A4',
ADD COLUMN     "role" "UserRole" NOT NULL DEFAULT 'USER',
ADD COLUMN     "timeZone" TEXT NOT NULL DEFAULT 'UTC';

-- Hand-written; keep if regenerating. Hosted Shortlist (Agents.md §2.1, docs/decisions.md
-- 2026-11-15): nothing changes for accounts that exist before this deploy.
--
-- 1. They were built on Lahore time and a US Letter resume.
UPDATE "User" SET "timeZone" = 'Asia/Karachi', "paperSize" = 'LETTER';

-- 2. A user without search settings used to be filtered with the builder's defaults
--    (DEFAULT_DISCOVERY_PREFERENCES). New users now get the neutral starter settings, so an
--    account that was already running discovery (it has a source) keeps the old defaults
--    as its own row. Values copied from DEFAULT_DISCOVERY_PREFERENCES on 2026-11-15.
INSERT INTO "DiscoveryPreferences" ("id", "userId", "titleInclude", "titleExclude", "stackKeywords", "roleTitleTerms", "onsiteLocations", "allowRemote", "remoteAllowRegions", "maxPostingAgeDays", "updatedAt")
SELECT gen_random_uuid()::TEXT, u."id",
  ARRAY['developer', 'engineer', 'software', 'frontend', 'front-end', 'front end', 'full stack', 'full-stack', 'fullstack', 'react', 'mern', 'javascript', 'typescript', 'web']::TEXT[],
  ARRAY['principal', 'staff', 'director', 'head of', 'vp', 'manager', 'architect', 'intern', 'internship', 'ios', 'android', 'flutter', 'kotlin', 'swift', 'embedded', 'firmware', 'data scientist', 'data engineer', 'data analyst', 'machine learning', 'ml engineer', 'devops', 'sre', 'site reliability', 'qa', 'sqa', 'test', 'security', 'salesforce', 'sap', 'sales', 'marketing', 'designer', 'recruiter', 'hr', 'support', 'werkstudent', 'praktikum', 'm/w/d', 'w/m/d', 'm/f/d']::TEXT[],
  ARRAY['react', 'react.js', 'reactjs', 'next.js', 'nextjs', 'typescript', 'javascript', 'node', 'node.js', 'nodejs', 'nestjs', 'express', 'mern', 'tailwind', 'angular']::TEXT[],
  ARRAY['software', 'full stack', 'full-stack', 'fullstack', 'frontend', 'front-end', 'front end', 'web developer', 'web engineer', 'web application', 'ui developer', 'ui engineer']::TEXT[],
  ARRAY['lahore', 'pakistan', 'pk']::TEXT[],
  true,
  ARRAY['worldwide', 'anywhere', 'anywhere in the world', 'global', 'globally', 'international', 'remote', 'asia', 'apac', 'asia pacific', 'south asia', 'pakistan', 'lahore', 'pk']::TEXT[],
  30,
  CURRENT_TIMESTAMP
FROM "User" u
WHERE NOT EXISTS (SELECT 1 FROM "DiscoveryPreferences" p WHERE p."userId" = u."id")
  AND EXISTS (SELECT 1 FROM "JobSource" s WHERE s."userId" = u."id");

-- 3. A user without AI settings used to get a $4.50 monthly budget. New accounts now start
--    lower (DEFAULT_AI_SETTINGS) and only an admin raises it, so existing accounts keep
--    their $4.50 as a row.
INSERT INTO "AiSettings" ("id", "userId", "maxAnalysesPerDay", "monthlyBudgetUsd", "resumeReuseMinOverlap", "updatedAt")
SELECT gen_random_uuid()::TEXT, u."id", 40, 4.50, 0.85, CURRENT_TIMESTAMP
FROM "User" u
WHERE NOT EXISTS (SELECT 1 FROM "AiSettings" a WHERE a."userId" = u."id");
