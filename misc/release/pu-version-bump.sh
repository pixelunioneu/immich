#!/usr/bin/env bash
# PixelUnion version bump: push main, cut the next vX.Y.Z-puN tag, and start
# the Docker PU pipeline (it triggers on pushed tags matching v*.*.*-pu*).
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

branch=$(git rev-parse --abbrev-ref HEAD)
if [[ "$branch" != "main" ]]; then
  echo "Must be on main (currently on $branch)" >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is not clean; commit or stash first" >&2
  exit 1
fi

base="v$(node -p "require('./server/package.json').version")"

git fetch origin --tags --quiet

last=$(git tag --list "${base}-pu*" | sed "s/^${base}-pu//" | sort -n | tail -1)
tag="${base}-pu$(( ${last:-0} + 1 ))"

echo "Pushing main and tagging ${tag}"
git push origin main
git tag -a "$tag" -m "$tag"
git push origin "$tag"

echo "Tag ${tag} pushed — Docker PU pipeline starts automatically."
if command -v gh >/dev/null; then
  sleep 10
  run_url=$(gh run list --workflow docker-pu.yml --branch "$tag" --limit 1 \
    --json url --jq '.[0].url' 2>/dev/null || true)
  if [[ -n "$run_url" ]]; then
    echo "Pipeline run: $run_url"
  else
    echo "Run not visible yet; check: gh run list --workflow docker-pu.yml"
  fi
fi
