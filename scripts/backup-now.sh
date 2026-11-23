#!/usr/bin/env bash
# Take a backup right now (database dump + file mirror, plus the off-site copy if configured).
#   ./scripts/backup-now.sh <client>
# Lists what's on disk afterwards. Nightly backups run automatically; use this
# before risky changes (upgrades, restores, migrations).
# shellcheck source=scripts/lib.sh
source "$(dirname "$0")/lib.sh"
use_client "${1:-}"
require_tools

compose run --rm backup once
info "dumps on this server:"
compose run --rm --entrypoint sh backup -c 'ls -lh /backups/db | tail -n 10'
