#!/usr/bin/env bash
# PixelUnion e2e: build and start the fork stack, run the API and web specs, stop the stack.
# Set PU_E2E_KEEP=1 to leave the stack running afterwards (then `mise run //e2e:pu-down`).
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "${PU_E2E_KEEP:-}" != "1" ]]; then
  trap './pu/compose.sh down -v --remove-orphans > /dev/null 2>&1 || true' EXIT
fi

./pu/compose.sh up -d --build --wait --wait-timeout 300 --renew-anon-volumes --force-recreate --remove-orphans

status=0
./node_modules/.bin/vitest --run --config vitest.pu.config.ts || status=$?
./node_modules/.bin/playwright test --config playwright.pu.config.ts || status=$?

if [[ $status -ne 0 ]]; then
  ./pu/compose.sh logs --no-color --tail 200 immich-server frontdoor e2e-auth-server || true
fi
exit $status
