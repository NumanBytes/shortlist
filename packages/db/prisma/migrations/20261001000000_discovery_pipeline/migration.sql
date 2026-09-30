-- Discovery pipeline: stable source keys, run counts, job <-> source/run links, and
-- the per-user rule-filter preferences (Agents.md §5).
-- DropIndex
DROP INDEX "DiscoveryRun_jobSourceId_idx";

-- AlterTable
ALTER TABLE "DiscoveryRun" ADD COLUMN     "jobsMatched" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "discoveryRunId" TEXT,
ADD COLUMN     "jobSourceId" TEXT,
ADD COLUMN     "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "JobSource" ADD COLUMN     "key" TEXT NOT NULL,
ADD COLUMN     "name" TEXT NOT NULL,
DROP COLUMN "lastRunStatus",
ADD COLUMN     "lastRunStatus" "DiscoveryRunStatus";

-- CreateTable
CREATE TABLE "DiscoveryPreferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "titleInclude" TEXT[],
    "titleExclude" TEXT[],
    "stackKeywords" TEXT[],
    "onsiteLocations" TEXT[],
    "allowRemote" BOOLEAN NOT NULL,
    "remoteExcludeRegions" TEXT[],
    "maxPostingAgeDays" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscoveryPreferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveryPreferences_userId_key" ON "DiscoveryPreferences"("userId");

-- CreateIndex
CREATE INDEX "DiscoveryRun_jobSourceId_startedAt_idx" ON "DiscoveryRun"("jobSourceId", "startedAt");

-- CreateIndex
CREATE INDEX "Job_userId_discoveredAt_idx" ON "Job"("userId", "discoveredAt");

-- CreateIndex
CREATE UNIQUE INDEX "JobSource_userId_key_key" ON "JobSource"("userId", "key");

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_jobSourceId_fkey" FOREIGN KEY ("jobSourceId") REFERENCES "JobSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_discoveryRunId_fkey" FOREIGN KEY ("discoveryRunId") REFERENCES "DiscoveryRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryPreferences" ADD CONSTRAINT "DiscoveryPreferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

