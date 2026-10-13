-- Pinned projects always appear on a tailored resume (docs/resume.md §13.7).
ALTER TABLE "Project" ADD COLUMN "isPinned" BOOLEAN NOT NULL DEFAULT false;
