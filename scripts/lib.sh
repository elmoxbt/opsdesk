#!/usr/bin/env bash
# Shared helpers for the client deployment scripts. Source it; don't run it.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

die() { echo "✖ $*" >&2; exit 1; }
info() { echo "▸ $*"; }
ok() { echo "✔ $*"; }
warn() { echo "⚠ $*" >&2; }

# Sets CLIENT, CLIENT_DIR, ENV_FILE and the compose variables for client "$1".
use_client() {
  CLIENT="${1:-}"
  [[ "$CLIENT" =~ ^[a-z0-9][a-z0-9-]{1,38}$ ]] || die "client name must be lowercase letters, digits and hyphens (got '${CLIENT}')"
  CLIENT_DIR="clients/$CLIENT"
  ENV_FILE="$ROOT/$CLIENT_DIR/.env"
  [[ -f "$CLIENT_DIR/client.config.ts" ]] || die "missing $CLIENT_DIR/client.config.ts (start from clients/example/)"
  [[ -f "$ENV_FILE" ]] || die "missing $CLIENT_DIR/.env (start from clients/example/.env.example)"
  # One compose project per client: separate containers, networks and volumes.
  export COMPOSE_PROJECT_NAME="opsdesk-$CLIENT"
  export CLIENT_CONFIG="$CLIENT_DIR/client.config.ts" # relative to the build context (repo root)
  export CLIENT_ENV_FILE="$ENV_FILE"
}

compose() { docker compose -f "$ROOT/infra/deploy/docker-compose.yml" --env-file "$ENV_FILE" "$@"; }

get_env() { grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' || true; }

set_env() {
  if grep -qE "^$1=" "$ENV_FILE"; then
    # '|' delimiter: generated values are alphanumeric or base64, so they can't contain it.
    sed -i.bak "s|^$1=.*|$1=$2|" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
  else
    printf '%s=%s\n' "$1" "$2" >>"$ENV_FILE"
  fi
}

require_tools() {
  command -v docker >/dev/null || die "Docker is not installed (see docs/deploying-a-client.md)"
  docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required"
  for t in "$@"; do command -v "$t" >/dev/null || die "$t is required"; done
}
