# syntax=docker/dockerfile:1.7
#
# OpsDesk API image for ONE client. Normally built by scripts/deploy-client.sh:
#   docker build -f infra/docker/api.Dockerfile --build-arg CLIENT_CONFIG=clients/acme/client.config.ts .
#
# The client's config is compiled and validated INTO the image (a typo fails the
# build, not production). Secrets and CLIENT_*/FEATURE_* overrides arrive at runtime via env.
ARG NODE_VERSION=22.11.0

FROM node:${NODE_VERSION}-alpine AS base
RUN apk add --no-cache libc6-compat openssl
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /repo

# Only the workspace packages the API depends on, so unrelated changes don't bust the cache.
FROM base AS pruned
COPY . .
RUN pnpm dlx turbo@2.3.3 prune @opsdesk/api --docker

FROM base AS build
COPY --from=pruned /repo/out/json/ ./
COPY --from=pruned /repo/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY --from=pruned /repo/out/full/ ./
ARG CLIENT_CONFIG=config/client.config.ts
COPY ${CLIENT_CONFIG} ./config/client.config.ts
RUN pnpm turbo run build --filter=@opsdesk/api... \
 && pnpm --filter @opsdesk/client-config check

FROM base AS runtime
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /repo /repo
COPY --chmod=755 infra/docker/api-entrypoint.sh /usr/local/bin/opsdesk
USER app
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:4000/api/health >/dev/null || exit 1
ENTRYPOINT ["opsdesk"]
CMD ["serve"]
