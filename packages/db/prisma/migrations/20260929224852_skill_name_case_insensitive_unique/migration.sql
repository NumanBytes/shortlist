-- Skill: one row per name per user, ignoring case — "React" and "react" collide.
-- The Prisma-level @@unique([userId, name]) is case-sensitive; Prisma can't express an
-- expression index, so this lives in raw SQL like the SkillEvidence CHECK constraint.
CREATE UNIQUE INDEX "Skill_userId_lower_name_key" ON "Skill" ("userId", lower("name"));
