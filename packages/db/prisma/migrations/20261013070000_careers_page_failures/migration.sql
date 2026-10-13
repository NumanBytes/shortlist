-- Remember a careers page whose reading failed, so it isn't re-read (and re-billed) until it
-- changes (docs/discovery.md §9.14, code review 2026-10-13).
-- AlterTable
ALTER TABLE "CareersPageSnapshot" ADD COLUMN     "failedHash" TEXT,
ADD COLUMN     "failure" TEXT,
ALTER COLUMN "extractedAt" DROP NOT NULL;

