#!/bin/sh
# OpsDesk backups.
#   schedule  (default) run "once" every day at BACKUP_HOUR (server local time, default 02)
#   once      dump the database + mirror uploaded files now
# Keeps BACKUP_RETENTION_DAYS of dumps in the "backups" volume and, if
# BACKUP_S3_BUCKET is set, copies everything to that off-site bucket.
set -eu

RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
HOUR="${BACKUP_HOUR:-02}"
NAME="${CLIENT_NAME:-opsdesk}"

log() { echo "[backup $(date -u +%FT%TZ)] $*"; }

once() {
  stamp="$(date -u +%Y%m%d-%H%M%S)"
  mkdir -p /backups/db /backups/files

  # Custom format: compressed, and restorable table-by-table with pg_restore.
  tmp="/backups/db/.${NAME}-${stamp}.dump.partial"
  pg_dump --format=custom --no-owner --file="$tmp"
  mv "$tmp" "/backups/db/${NAME}-${stamp}.dump" # rename only once complete
  log "database dump: ${NAME}-${stamp}.dump ($(du -h "/backups/db/${NAME}-${stamp}.dump" | cut -f1))"

  # Mirror uploaded photos/signatures through the S3 API (MinIO's on-disk format isn't plain files).
  AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$S3_SECRET_KEY" \
    aws --endpoint-url "$S3_SOURCE_ENDPOINT" s3 sync "s3://opsdesk" /backups/files --only-show-errors
  log "files mirrored"

  find /backups/db -name "*.dump" -mtime +"$RETENTION_DAYS" -delete
  log "pruned dumps older than ${RETENTION_DAYS} days"

  if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
    export AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_KEY"
    endpoint=""
    [ -n "${BACKUP_S3_ENDPOINT:-}" ] && endpoint="--endpoint-url $BACKUP_S3_ENDPOINT"
    # shellcheck disable=SC2086 # $endpoint is intentionally word-split (empty or two words)
    aws $endpoint s3 cp "/backups/db/${NAME}-${stamp}.dump" "s3://${BACKUP_S3_BUCKET}/${NAME}/db/" --only-show-errors
    # shellcheck disable=SC2086
    aws $endpoint s3 sync /backups/files "s3://${BACKUP_S3_BUCKET}/${NAME}/files/" --only-show-errors
    log "copied off-site to s3://${BACKUP_S3_BUCKET}/${NAME}/"
  else
    log "WARNING: no BACKUP_S3_BUCKET set; backups exist only on this server"
  fi
}

case "${1:-schedule}" in
  once) once ;;
  schedule)
    log "scheduled daily at ${HOUR}:00 (retention ${RETENTION_DAYS} days)"
    while true; do
      if [ "$(date +%H)" = "$HOUR" ]; then
        once || log "ERROR: backup failed (will retry tomorrow; check the logs)"
        sleep 3600 # don't run twice in the same hour
      fi
      sleep 300
    done
    ;;
  *) echo "usage: backup.sh [schedule|once]" >&2; exit 64 ;;
esac
