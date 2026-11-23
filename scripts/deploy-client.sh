#!/usr/bin/env bash
# Deploy, or update, ONE client's OpsDesk instance on this server.
#
#   ./scripts/deploy-client.sh <client> [--seed-demo] [--skip-build]
#
# Expects clients/<client>/client.config.ts and clients/<client>/.env
# (copy clients/example/). Safe to re-run: that's how you ship updates.
# Full guide: docs/deploying-a-client.md
# shellcheck source=scripts/lib.sh
source "$(dirname "$0")/lib.sh"

usage() { sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }
[[ "${1:-}" == "-h" || "${1:-}" == "--help" || -z "${1:-}" ]] && usage 0

use_client "$1"
shift
SEED_DEMO=0
SKIP_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --seed-demo) SEED_DEMO=1 ;;
    --skip-build) SKIP_BUILD=1 ;;
    -h | --help) usage 0 ;;
    *) die "unknown option: $arg" ;;
  esac
done
require_tools openssl
chmod 600 "$ENV_FILE"

# ---- 1. Secrets: generate any left as "generate" (or empty), never touch existing ones ----
GENERATED_OWNER_PASSWORD=""
for var in POSTGRES_PASSWORD JWT_ACCESS_SECRET S3_ACCESS_KEY S3_SECRET_KEY OWNER_INITIAL_PASSWORD; do
  val="$(get_env "$var")"
  if [[ -z "$val" || "$val" == "generate" ]]; then
    new="$(openssl rand -base64 64 | tr -dc 'A-Za-z0-9' | head -c 40)"
    set_env "$var" "$new"
    info "generated $var"
    [[ "$var" == "OWNER_INITIAL_PASSWORD" ]] && GENERATED_OWNER_PASSWORD="$new"
  fi
done
# Encryption key for secrets at rest (webhook signing secrets): exactly 32 random bytes, base64.
# Back it up with the database: without it, stored webhook secrets can't be read (rotate them if lost).
val="$(get_env DATA_ENCRYPTION_KEY)"
if [[ -z "$val" || "$val" == "generate" ]]; then
  set_env DATA_ENCRYPTION_KEY "$(openssl rand -base64 32)"
  info "generated DATA_ENCRYPTION_KEY"
fi

# ---- 2. Sanity checks that save a failed certificate request later ----
for var in APP_DOMAIN FILES_DOMAIN ACME_EMAIL; do
  [[ -n "$(get_env "$var")" ]] || die "$var must be set in $CLIENT_DIR/.env"
done
APP_DOMAIN="$(get_env APP_DOMAIN)"
FILES_DOMAIN="$(get_env FILES_DOMAIN)"
for host in "$APP_DOMAIN" "$FILES_DOMAIN"; do
  [[ "$host" == *.example* ]] && warn "$host is a placeholder domain; HTTPS will fail until it's real"
  getent hosts "$host" >/dev/null 2>&1 || warn "$host doesn't resolve yet. Point its DNS A/AAAA record at this server first."
done

# ---- 3. Build the API first: it's the image that can read this client's resolved config ----
if [[ $SKIP_BUILD == 0 ]]; then
  info "building images for $CLIENT (a few minutes the first time)"
  compose build api
fi

info "checking this deployment's config (file + env overrides)"
config_json="$(compose run --rm --no-deps api check-config)" || die "invalid client config (see above)"
echo "   $config_json"

# Online payments need a gateway key; fail now rather than with a crash-looping API.
if grep -q '"payments"' <<<"$config_json" && [[ -z "$(get_env PAYSTACK_SECRET_KEY)" ]]; then
  die "features.payments is on but PAYSTACK_SECRET_KEY is empty in $CLIENT_DIR/.env (or set FEATURE_PAYMENTS=false)"
fi

# Optional apps run only when their feature is on (compose profiles).
profiles=()
grep -q '"technicianApp"' <<<"$config_json" && profiles+=("technician-app")
COMPOSE_PROFILES="$(IFS=,; echo "${profiles[*]}")"
export COMPOSE_PROFILES
info "optional apps: ${COMPOSE_PROFILES:-none}"

if [[ $SKIP_BUILD == 0 ]]; then
  compose build
fi

# ---- 4. Data services, then one-off tasks against them ----
info "starting postgres, redis and object storage"
compose up -d --wait postgres redis minio
compose run --rm minio-init >/dev/null

info "applying database migrations"
compose run --rm --no-deps api migrate

info "bootstrapping the business and owner account"
if ! out="$(compose run --rm --no-deps api bootstrap 2>&1)"; then
  echo "$out" >&2
  die "bootstrap failed (see above)"
fi
echo "$out"
OWNER_PASSWORD_SHOWN=""
if grep -q "owner created" <<<"$out"; then
  OWNER_PASSWORD_SHOWN="$(get_env OWNER_INITIAL_PASSWORD)"
  # The initial password has done its job; don't leave it lying around in env.
  set_env OWNER_INITIAL_PASSWORD consumed
fi

if [[ $SEED_DEMO == 1 ]]; then
  warn "seeding DEMO data (fake staff, customers and jobs). Don't do this for a real client."
  compose run --rm --no-deps api seed-demo
fi

# ---- 5. Everything else, and wait until healthy ----
info "starting the app"
compose up -d --wait --remove-orphans

ok "$CLIENT is live at https://$APP_DOMAIN"
echo "   files:   https://$FILES_DOMAIN (presigned URLs only)"
echo "   backups: nightly, see: ./scripts/backup-now.sh $CLIENT"
echo "   logs:    docker compose -p $COMPOSE_PROJECT_NAME logs -f api"
if [[ -n "$OWNER_PASSWORD_SHOWN" ]]; then
  echo
  echo "   Owner sign-in (shown ONCE: store it in a password manager now):"
  echo "     password: $OWNER_PASSWORD_SHOWN"
  [[ -n "$GENERATED_OWNER_PASSWORD" ]] && echo "     (generated; it has been removed from $CLIENT_DIR/.env)"
fi
