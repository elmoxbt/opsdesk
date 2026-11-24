# syntax=docker/dockerfile:1.7
#
# OpsDesk technician PWA for ONE client, served at /tech (Next.js standalone).
#   docker build -f infra/docker/tech.Dockerfile --build-arg CLIENT_CONFIG=clients/acme/client.config.ts .
ARG NODE_VERSION=22.20.0

FROM node:${NODE_VERSION}-alpine AS base
RUN apk add --no-cache libc6-compat
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /repo

FROM base AS pruned
COPY . .
RUN pnpm dlx turbo@2.3.3 prune @opsdesk/tech --docker

FROM base AS build
COPY --from=pruned /repo/out/json/ ./
COPY --from=pruned /repo/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY --from=pruned /repo/out/full/ ./
# turbo prune keeps workspaces, not root config files the builds extend.
COPY --from=pruned /repo/tsconfig.base.json ./tsconfig.base.json
ARG CLIENT_CONFIG=config/client.config.ts
COPY ${CLIENT_CONFIG} ./config/client.config.ts
ENV NEXT_OUTPUT=standalone
RUN pnpm turbo run build --filter=@opsdesk/tech... \
 && pnpm --filter @opsdesk/client-config check

FROM node:${NODE_VERSION}-alpine AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3001 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=build --chown=app:app /repo/apps/tech/.next/standalone ./
COPY --from=build --chown=app:app /repo/apps/tech/.next/static ./apps/tech/.next/static
COPY --from=build --chown=app:app /repo/apps/tech/public ./apps/tech/public
USER app
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3001/tech/login >/dev/null || exit 1
CMD ["node", "apps/tech/server.js"]
