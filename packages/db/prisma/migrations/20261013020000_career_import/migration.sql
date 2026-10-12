-- Resume import (docs/career-data.md §7.6).
-- CreateEnum
CREATE TYPE "CareerImportStatus" AS ENUM ('PENDING', 'DONE', 'DEFERRED', 'FAILED');

-- AlterEnum
ALTER TYPE "AiPurpose" ADD VALUE 'IMPORT_RESUME';

-- CreateTable
CREATE TABLE "CareerImport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "CareerImportStatus" NOT NULL DEFAULT 'PENDING',
    "text" TEXT,
    "created" JSONB,
    "dropped" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "CareerImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CareerImport_userId_createdAt_idx" ON "CareerImport"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "CareerImport" ADD CONSTRAINT "CareerImport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

