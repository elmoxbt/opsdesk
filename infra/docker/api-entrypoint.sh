#!/bin/sh
# One image, several jobs. Used as:  docker compose run --rm api <command>
set -eu
cd /repo

case "${1:-serve}" in
  serve)
    exec node apps/api/dist/main.js
    ;;
  worker)
    # Background jobs (PDFs, reminders) from Redis. Same image and config as the API.
    exec node apps/api/dist/worker.js
    ;;
  migrate)
    # Applies pending migrations; never resets or generates. Safe to re-run.
    cd packages/db
    exec node node_modules/prisma/build/index.js migrate deploy
    ;;
  bootstrap)
    # Creates/syncs THE organization + owner from the built-in client config.
    exec node packages/db/dist/bootstrap.js
    ;;
  seed-demo)
    # Demo staff, customers and jobs. For demos and staging, not for real clients.
    exec node packages/db/dist/seed.js
    ;;
  check-config)
    # Prints this deployment's resolved config (file + env overrides), or the validation errors.
    cd apps/api
    exec node -e '
      const c = require("@opsdesk/client-config").loadClientConfig();
      const on = Object.entries(c.features).filter(([, v]) => v).map(([k]) => k);
      console.log(JSON.stringify({ business: c.business.name, domain: c.domains.app, features: on }));
    '
    ;;
  *)
    echo "usage: opsdesk [serve|worker|migrate|bootstrap|seed-demo|check-config]" >&2
    exit 64
    ;;
esac
