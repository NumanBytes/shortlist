-- AlterTable
ALTER TABLE "JobSource" ADD COLUMN     "catalogEntryId" TEXT;

-- CreateTable
CREATE TABLE "SourceCatalogEntry" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "JobSourceType" NOT NULL,
    "config" JSONB NOT NULL,
    "regions" TEXT[],
    "isListed" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceCatalogEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SourceCatalogEntry_key_key" ON "SourceCatalogEntry"("key");

-- CreateIndex
CREATE INDEX "JobSource_catalogEntryId_idx" ON "JobSource"("catalogEntryId");

-- AddForeignKey
ALTER TABLE "JobSource" ADD CONSTRAINT "JobSource_catalogEntryId_fkey" FOREIGN KEY ("catalogEntryId") REFERENCES "SourceCatalogEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Hand-written; keep if regenerating. The remote boards every user can follow (REMOTE_BOARDS
-- in @shortlist/shared, copied 2026-11-16), so a fresh server's onboarding has something to
-- follow before an admin seeds the rest (db:seed:catalog, docs/discovery.md §9.16).
INSERT INTO "SourceCatalogEntry" ("id", "key", "name", "type", "config", "regions", "updatedAt") VALUES
  (gen_random_uuid()::TEXT, 'remoteok', 'Remote OK', 'AGGREGATOR_API', '{"provider":"remoteok"}'::JSONB, ARRAY['remote']::TEXT[], CURRENT_TIMESTAMP),
  (gen_random_uuid()::TEXT, 'remotive:software-dev', 'Remotive', 'AGGREGATOR_API', '{"provider":"remotive","category":"software-dev"}'::JSONB, ARRAY['remote']::TEXT[], CURRENT_TIMESTAMP),
  (gen_random_uuid()::TEXT, 'arbeitnow', 'Arbeitnow', 'AGGREGATOR_API', '{"provider":"arbeitnow","maxPages":3}'::JSONB, ARRAY['remote']::TEXT[], CURRENT_TIMESTAMP),
  (gen_random_uuid()::TEXT, 'himalayas', 'Himalayas', 'AGGREGATOR_API', '{"provider":"himalayas","maxPages":5}'::JSONB, ARRAY['remote']::TEXT[], CURRENT_TIMESTAMP),
  (gen_random_uuid()::TEXT, 'jobicy', 'Jobicy', 'AGGREGATOR_API', '{"provider":"jobicy"}'::JSONB, ARRAY['remote']::TEXT[], CURRENT_TIMESTAMP),
  (gen_random_uuid()::TEXT, 'weworkremotely:full-stack', 'We Work Remotely — Full-Stack', 'AGGREGATOR_API', '{"provider":"weworkremotely","category":"remote-full-stack-programming-jobs"}'::JSONB, ARRAY['remote']::TEXT[], CURRENT_TIMESTAMP),
  (gen_random_uuid()::TEXT, 'weworkremotely:front-end', 'We Work Remotely — Front-End', 'AGGREGATOR_API', '{"provider":"weworkremotely","category":"remote-front-end-programming-jobs"}'::JSONB, ARRAY['remote']::TEXT[], CURRENT_TIMESTAMP);

-- Existing accounts' copies of those boards become follows, when the address is the same.
UPDATE "JobSource" s SET "catalogEntryId" = c."id"
FROM "SourceCatalogEntry" c
WHERE s."key" = c."key" AND s."config" = c."config" AND s."catalogEntryId" IS NULL;
