#!/usr/bin/env bash
# PixelUnion e2e: docker compose for the fork stack (upstream compose file + docker-compose.pu.yml).
# Usage: pu/compose.sh <compose args>, e.g. `pu/compose.sh up -d --build --wait`.
set -euo pipefail
cd "$(dirname "$0")/.."

# The front door reports the version it is given; a deployment sets it from the server image.
FRONTDOOR_IMMICH_VERSION="$(node -p "require('../server/package.json').version")"
export FRONTDOOR_IMMICH_VERSION

exec docker compose -f docker-compose.yml -f docker-compose.pu.yml "$@"
