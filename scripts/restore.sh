#!/usr/bin/env bash
# Restore a client's database (and optionally uploaded files) from a backup.
#   ./scripts/restore.sh <client> <dump-file> [--with-files]
# <dump-file> is a name from `./scripts/backup-now.sh <client>`'s listing,
# e.g. opsdesk-acme-20261120-020000.dump. Off-site copies: download them into
# the backups volume first (see docs/deploying-a-client.md#restoring).
#
# DESTRUCTIVE: replaces the current database. Takes a safety backup first.
# shellcheck source=scripts/lib.sh
source "$(dirname "$0")/lib.sh"
use_client "${1:-}"
DUMP="${2:-}"
WITH_FILES=0
[[ "${3:-}" == "--with-files" ]] && WITH_FILES=1
[[ "$DUMP" =~ ^[A-Za-z0-9._-]+\.dump$ ]] || die "usage: restore.sh <client> <dump-file> [--with-files]"
# shellcheck disable=SC2119 # Docker only: this script needs no extra tools.
require_tools

compose run --rm --entrypoint sh backup -c "test -f /backups/db/$DUMP" || die "no such dump: $DUMP"

echo "This REPLACES $CLIENT's live database with $DUMP."
read -r -p "Type the client name ($CLIENT) to continue: " answer
[[ "$answer" == "$CLIENT" ]] || die "aborted"

info "safety backup of the current state first"
compose run --rm backup once

info "stopping the app (database stays up)"
compose stop caddy web api

info "restoring $DUMP"
compose run --rm --entrypoint sh backup -c \
  "pg_restore --clean --if-exists --no-owner --single-transaction --dbname=\"\$PGDATABASE\" /backups/db/$DUMP"

if [[ $WITH_FILES == 1 ]]; then
  info "restoring uploaded files"
  # shellcheck disable=SC2016 # expands inside the container, where the S3 credentials live
  compose run --rm --entrypoint sh backup -c \
    'AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$S3_SECRET_KEY" aws --endpoint-url "$S3_SOURCE_ENDPOINT" s3 sync /backups/files s3://opsdesk --only-show-errors'
fi

info "re-applying migrations (an older dump may predate the current code)"
compose run --rm --no-deps api migrate

info "starting the app"
compose up -d --wait
ok "restored $CLIENT from $DUMP"
