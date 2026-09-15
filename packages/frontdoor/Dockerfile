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
# The package bundles server sources: the Kysely schema types and the user-agent
# parsing the session refresh depends on.
COPY ./server ./server/

RUN pnpm --filter @immich/frontdoor --frozen-lockfile --force install
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
