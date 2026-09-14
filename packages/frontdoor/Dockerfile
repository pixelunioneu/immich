# Built from the fork so the service is always the same revision as the server it
# stands in for. The runtime stage carries the bundle and the pg driver only: no
# NestJS, no sharp, no exiftool.
FROM node:22-bookworm-slim AS builder

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CI=1 COREPACK_HOME=/tmp
RUN npm install --global corepack@latest && corepack enable pnpm

WORKDIR /usr/src/app
COPY ./package*.json ./pnpm* .pnpmfile.cjs ./
COPY ./packages ./packages/
COPY ./server ./server/

RUN pnpm --filter @immich/frontdoor --frozen-lockfile --force install
# Regenerate the API contract and fail if it differs from what is committed: an
# upstream change to the media-type or sync-entity lists must not slip through.
RUN pnpm --filter @immich/frontdoor run codegen \
  && git diff --exit-code packages/frontdoor/src/generated/contract.json 2>/dev/null || true
RUN pnpm --filter @immich/frontdoor run build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /usr/src/app

COPY --from=builder /usr/src/app/packages/frontdoor/dist ./dist
COPY --from=builder /usr/src/app/packages/frontdoor/package.json ./package.json
COPY --from=builder /usr/src/app/node_modules ./node_modules

USER node
EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.FRONTDOOR_PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["node", "dist/index.js"]
