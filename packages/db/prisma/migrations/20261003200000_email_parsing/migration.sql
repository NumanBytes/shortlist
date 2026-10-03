-- Email parsing (Agents.md §10.4–10.5): partial-info jobs, salary text, email outcome
-- statuses, and the AI extraction purpose.

-- AlterEnum
ALTER TYPE "AiPurpose" ADD VALUE 'EXTRACT_EMAIL';

-- AlterEnum


ALTER TYPE "EmailStatus" ADD VALUE 'NOT_ALERT';
ALTER TYPE "EmailStatus" ADD VALUE 'DEFERRED';

-- AlterTable
ALTER TABLE "EmailMessage" ADD COLUMN     "note" TEXT,
ADD COLUMN     "portal" TEXT;

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "isPartial" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "salary" TEXT;


-- Messages read before parsing existed were only recorded as UNPARSED. Forget them and the
-- last-check time, so the next check reads the last 30 days again — this time into jobs.
DELETE FROM "EmailMessage" WHERE "status" = 'UNPARSED';
UPDATE "GmailConnection" SET "lastCheckedAt" = NULL, "lastCheckStatus" = NULL, "lastCheckFound" = NULL;
