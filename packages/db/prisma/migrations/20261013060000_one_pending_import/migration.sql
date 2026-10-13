-- At most one pending resume import per user (docs/career-data.md §7.6). A partial unique index:
-- Prisma can't express it, and a read-then-insert check let two racing requests both create
-- one (code review 2026-10-13). Keep it if migrations are ever regenerated.
CREATE UNIQUE INDEX "CareerImport_one_pending_per_user" ON "CareerImport" ("userId") WHERE "status" = 'PENDING';
