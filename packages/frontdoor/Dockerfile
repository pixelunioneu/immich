# Built from the fork so the service is always the same revision as the server it
# stands in for. The bundle is self-contained, so the runtime stage carries one
# file and no node_modules: no NestJS, no sharp, no exiftool, no driver to resolve.
#
# The generated API contract is verified by CI (mise run check-contract), not here:
# the build context has no git history to diff against.
FROM node:22-bookworm-slim AS builder

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    CI=1 \
    COREPACK_HOME=/tmp
RUN npm install --global corepack@latest && corepack enable pnpm

WORKDIR /usr/src/app

COPY ./package.json ./pnpm-lock.yaml ./pnpm-workspace.yaml ./.pnpmfile.cjs ./
COPY ./packages/frontdoor ./packages/frontdoor/
# The package bundles server sources: the sync service and repository, the
# Kysely schema types and the user-agent parsing the session refresh depends on.
COPY ./server ./server/
# A workspace dependency of the bundled server sources. Only its manifest, so
# pnpm can link it, and its source, which is bundled directly (see vite.config.ts).
COPY ./packages/plugin-sdk/package.json ./packages/plugin-sdk/
COPY ./packages/plugin-sdk/src ./packages/plugin-sdk/src/

RUN pnpm --filter @immich/frontdoor --frozen-lockfile --force install
# The bundled server sources resolve their imports against server/node_modules,
# which is never installed here. Every package they reach for at runtime is
# declared by this package, so let them find it there. A missing one fails the
# build, which is the right time to find out.
RUN ln -s /usr/src/app/packages/frontdoor/node_modules /usr/src/app/server/node_modules
RUN pnpm --filter @immich/frontdoor run build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /usr/src/app

COPY --from=builder /usr/src/app/packages/frontdoor/dist/index.js ./index.js

USER node
EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.FRONTDOOR_PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["node", "index.js"]
