#!/bin/sh
# Nightly Postgres dump (run by the `backup` service). Compressed, one file per night,
# KEEP_DAYS kept. They land in deploy/backups/ on the server's disk — that guards against
# mistakes (a bad migration, a deleted row), not against losing the server; copy them
# off the machine too (deploy/README.md, "Backups").
set -eu
file="/backups/shortlist-$(date +%Y-%m-%d_%H%M).sql.gz"
pg_dump --no-owner --no-privileges | gzip > "$file.tmp"
mv "$file.tmp" "$file" # a half-written dump is never mistaken for a good one
find /backups -name 'shortlist-*.sql.gz' -mtime +"${KEEP_DAYS:-14}" -delete
echo "backup: wrote $file"
