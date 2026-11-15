-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('FREE', 'STARTER', 'PRO');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "plan" "Plan" NOT NULL DEFAULT 'FREE';


-- Hand-written; keep if regenerating. Accounts from before plans existed keep everything they
-- use today — "Find new jobs" and nightly discovery included — so they start on Pro. An admin
-- can change any of them (docs/ai-scoring.md §12.5). Their dollar budgets are left as they are.
UPDATE "User" SET "plan" = 'PRO';
