-- Simplicant now has an adapter (docs/discovery.md §9.3); 7Vals' row already holds its board URL.
UPDATE "JobSource" SET "isEnabled" = true WHERE "config"->>'provider' = 'simplicant';
