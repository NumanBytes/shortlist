-- Account deletion (docs/security.md §8.8): a deleted account's AI usage rows stay, unlinked,
-- so the server-wide monthly cap still counts money already spent.
ALTER TABLE "AiUsage" DROP CONSTRAINT "AiUsage_userId_fkey";

ALTER TABLE "AiUsage" ALTER COLUMN "userId" DROP NOT NULL;

ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
