-- CreateEnum
CREATE TYPE "NeverClaimScope" AS ENUM ('ANYWHERE', 'PAID_WORK');

-- CreateTable
CREATE TABLE "NeverClaim" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "scope" "NeverClaimScope" NOT NULL DEFAULT 'ANYWHERE',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NeverClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NeverClaim_userId_idx" ON "NeverClaim"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "NeverClaim_userId_term_scope_key" ON "NeverClaim"("userId", "term", "scope");

-- AddForeignKey
ALTER TABLE "NeverClaim" ADD CONSTRAINT "NeverClaim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Carry over the checks that were hardcoded in checkBullet() until now (docs/career-data.md
-- §7.2, docs/resume.md §13.8), so tailoring never runs without them. They are the CloudCard
-- employee's known false claims, so they go only to users with a CloudCard role; the user
-- can edit or remove them in the app like any other entry.
INSERT INTO "NeverClaim" ("id", "userId", "term", "scope", "note")
SELECT gen_random_uuid()::text, u."id", t.term, t.scope::"NeverClaimScope", t.note
FROM "User" u
CROSS JOIN (VALUES
  ('Azure', 'ANYWHERE', 'Never worked with Azure; CloudCard''s B2C layer is not Azure B2C.'),
  ('Node.js', 'PAID_WORK', 'Node.js was never used at CloudCard.'),
  ('Express', 'PAID_WORK', 'Express was never used at CloudCard.')
) AS t(term, scope, note)
WHERE EXISTS (SELECT 1 FROM "WorkExperience" w WHERE w."userId" = u."id" AND w."company" ILIKE 'CloudCard%');
