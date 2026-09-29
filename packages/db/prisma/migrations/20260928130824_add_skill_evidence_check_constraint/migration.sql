-- SkillEvidence: workExperienceId and projectId must not both be set at once.
ALTER TABLE "SkillEvidence"
  ADD CONSTRAINT "chk_evidence_single_source"
  CHECK (NOT ("workExperienceId" IS NOT NULL AND "projectId" IS NOT NULL));