-- Milestone 3: custom careers pages, read by a change watcher (docs/discovery.md §9.14).
-- AlterEnum
ALTER TYPE "AiPurpose" ADD VALUE 'EXTRACT_CAREERS_PAGE';

-- CreateTable
CREATE TABLE "CareersPageSnapshot" (
    "id" TEXT NOT NULL,
    "jobSourceId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "openings" JSONB NOT NULL,
    "extractedAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CareersPageSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CareersPageSnapshot_jobSourceId_key" ON "CareersPageSnapshot"("jobSourceId");

-- AddForeignKey
ALTER TABLE "CareersPageSnapshot" ADD CONSTRAINT "CareersPageSnapshot_jobSourceId_fkey" FOREIGN KEY ("jobSourceId") REFERENCES "JobSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- RipeSeed's row pointed at its home page; its openings are on /careers.
UPDATE "JobSource"
SET "config" = '{"provider": "careers_page", "url": "https://ripeseed.io/careers"}'::jsonb
WHERE "key" = 'careers_page:ripeseed' AND "config"->>'url' = 'https://ripeseed.io/';

-- Switch on the pages a reader can use (probed 2026-10-13). Off: CodingCops (no careers
-- page), The Developers Arena (JavaScript app), The TCM Group (403), Qbatch (404), Conrad Labs
-- (domain gone).
UPDATE "JobSource"
SET "isEnabled" = true
WHERE "config"->>'provider' = 'careers_page'
  AND "key" NOT IN (
    'careers_page:codingcops',
    'careers_page:the-developers-arena',
    'careers_page:the-tcm-group',
    'careers_page:qbatch',
    'careers_page:conrad-labs'
  );
