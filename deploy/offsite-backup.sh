#!/bin/sh
# Copies the newest nightly dump off the server (run by the `offsite` service at 04:00, half
# an hour after backup.sh). deploy/backups/ dies with the server; this copy doesn't, so it
# lives outside the hosting provider: Google Drive by default (docs/architecture.md §4,
# deploy/README.md "Off-site copies").
#
# Fails loudly (non-zero exit, log line, optional /fail ping) when there's nothing fresh to
# copy: a dump older than 26 hours means the nightly backup itself has stopped.
set -eu
remote="${OFFSITE_REMOTE:-gdrive:shortlist-backups}"

# Optional dead man's switch (e.g. healthchecks.io): pinged on success and on failure, so
# it emails when a night goes by with no successful ping, even if this script never runs.
ping() {
  if [ -n "${OFFSITE_PING_URL:-}" ]; then wget -q -T 10 -O /dev/null "$OFFSITE_PING_URL$1" || true; fi
}
fail() {
  echo "offsite: FAILED: $1" >&2
  ping /fail
  exit 1
}

newest=$(ls -1t /backups/shortlist-*.sql.gz 2>/dev/null | head -n 1) || true
[ -n "$newest" ] || fail "no dump in /backups"
[ -n "$(find "$newest" -mmin -1560)" ] || fail "newest dump $(basename "$newest") is older than 26 hours"

# copy skips a file that's already there, so re-running is harmless
rclone copy "$newest" "$remote" || fail "upload of $(basename "$newest") to $remote failed"
rclone delete --min-age "${OFFSITE_KEEP_DAYS:-30}d" "$remote" || fail "pruning old copies in $remote failed"

echo "offsite: copied $(basename "$newest") to $remote"
ping ""
