-- Resume library (Agents.md §13.4): TailoredResume (one per match, never used — 0 rows) is
-- replaced by reusable ResumeVariant rows plus a JobResume record per job.

-- CreateEnum
CREATE TYPE "ResumeStatus" AS ENUM ('DRAFT', 'APPROVED');

-- CreateEnum
CREATE TYPE "JobResumeStatus" AS ENUM ('PENDING', 'READY', 'DEFERRED', 'FAILED');

-- DropForeignKey
ALTER TABLE "TailoredResume" DROP CONSTRAINT "TailoredResume_jobMatchId_fkey";

-- AlterTable
ALTER TABLE "AiSettings" ADD COLUMN     "resumeReuseMinOverlap" DECIMAL(3,2) NOT NULL DEFAULT 0.85;

-- DropTable
DROP TABLE "TailoredResume";

-- CreateTable
CREATE TABLE "ResumeVariant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "ResumeStatus" NOT NULL DEFAULT 'DRAFT',
    "content" JSONB NOT NULL,
    "evidenceIds" TEXT[],
    "requirementProfile" TEXT[],
    "model" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResumeVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobResume" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "variantId" TEXT,
    "status" "JobResumeStatus" NOT NULL,
    "error" TEXT,
    "reused" BOOLEAN NOT NULL DEFAULT false,
    "overlap" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobResume_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResumeVariant_userId_idx" ON "ResumeVariant"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "JobResume_jobId_key" ON "JobResume"("jobId");

-- AddForeignKey
ALTER TABLE "ResumeVariant" ADD CONSTRAINT "ResumeVariant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobResume" ADD CONSTRAINT "JobResume_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobResume" ADD CONSTRAINT "JobResume_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ResumeVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

