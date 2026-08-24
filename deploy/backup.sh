#!/usr/bin/env bash
# Nightly database backup with 14-day rotation.
# Cron (on the box that can reach Postgres):
#   0 3 * * * DATABASE_URL=postgres://... /path/to/ai-tutor/deploy/backup.sh /var/backups/tutor
set -euo pipefail

DEST="${1:?usage: backup.sh <dest-dir>}"
: "${DATABASE_URL:?set DATABASE_URL}"
mkdir -p "$DEST"

STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="$DEST/tutor-$STAMP.sql.gz"

pg_dump --no-owner --no-privileges "$DATABASE_URL" | gzip > "$FILE"
echo "backup written: $FILE ($(du -h "$FILE" | cut -f1))"

# Rotate: keep the newest 14
ls -1t "$DEST"/tutor-*.sql.gz 2>/dev/null | tail -n +15 | xargs -r rm --
echo "retained: $(ls -1 "$DEST"/tutor-*.sql.gz | wc -l) backups"

# Optional offsite: set OFFSITE_CMD to e.g. 'rclone copy "$FILE" remote:tutor-backups'
if [ -n "${OFFSITE_CMD:-}" ]; then
  eval "$OFFSITE_CMD"
  echo "offsite copy done"
fi
