-- Remote roles: allow-list of regions replaces the block-list (Agents.md §9.6).
-- No DiscoveryPreferences rows existed when this was written, so nothing is lost.
-- AlterTable
ALTER TABLE "DiscoveryPreferences" DROP COLUMN "remoteExcludeRegions",
ADD COLUMN     "remoteAllowRegions" TEXT[];

