-- Alert-email jobs have no description to check for the stack: they pass on a stack
-- keyword in the title/summary or a software-role title (Agents.md §9.6, §10.5).
-- No DiscoveryPreferences rows exist yet, so nothing needs a value.
-- AlterTable
ALTER TABLE "DiscoveryPreferences" ADD COLUMN     "roleTitleTerms" TEXT[];

