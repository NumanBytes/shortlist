-- AI analysis (Agents.md §12): per-job analysis state, requirement -> verified-skill
-- mapping, deterministic JobMatch fields, and the budget guard's settings and usage log.
-- CreateEnum
CREATE TYPE "JobAnalysisStatus" AS ENUM ('PENDING', 'DONE', 'DEFERRED', 'FAILED');

-- CreateEnum
CREATE TYPE "MatchVerdict" AS ENUM ('APPLY', 'STRETCH', 'SKIP');

-- CreateEnum
CREATE TYPE "AiPurpose" AS ENUM ('ANALYZE_JOB', 'TAILOR_RESUME', 'DISCOVER_SOURCES');

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "analysisError" TEXT,
ADD COLUMN     "analysisStatus" "JobAnalysisStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "analyzedAt" TIMESTAMP(3),
ADD COLUMN     "redFlags" TEXT[],
ADD COLUMN     "seniority" TEXT;

-- AlterTable
ALTER TABLE "JobMatch" DROP COLUMN "verdict",
ADD COLUMN     "verdict" "MatchVerdict" NOT NULL,
DROP COLUMN "strengths",
ADD COLUMN     "strengths" TEXT[],
DROP COLUMN "risks",
ADD COLUMN     "risks" TEXT[];

-- AlterTable
ALTER TABLE "JobRequirement" ADD COLUMN     "isCore" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "matchedSkillIds" TEXT[];

-- CreateTable
CREATE TABLE "AiSettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "maxAnalysesPerDay" INTEGER NOT NULL,
    "monthlyBudgetUsd" DECIMAL(8,2) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUsage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT,
    "purpose" "AiPurpose" NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(12,6) NOT NULL,
    "succeeded" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiSettings_userId_key" ON "AiSettings"("userId");

-- CreateIndex
CREATE INDEX "AiUsage_userId_createdAt_idx" ON "AiUsage"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "AiSettings" ADD CONSTRAINT "AiSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "JobRequirement" ADD COLUMN     "relatedSkillIds" TEXT[];
-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "yearsRequired" INTEGER;
-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "analyzedSkillIds" TEXT[];
