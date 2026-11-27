#!/usr/bin/env bash
# PixelUnion e2e: dump the database of a freshly started fork stack as an upgrade-path fixture.
# See README.md in this directory for when (and when not) to run this.
#
# Usage: pu/fixtures/dump-schema.sh <output.sql>
set -euo pipefail

output="${1:?usage: $0 <output.sql>}"

# Geodata and the core plugin (a multi-megabyte wasm blob) are loaded at boot and are
# large; migrations need the schema and the migration history, not those rows.
docker exec immich-e2e-postgres pg_dump -U postgres -d immich \
  --no-owner --no-privileges \
  --exclude-table-data=geodata_places \
  --exclude-table-data=naturalearth_countries \
  --exclude-table-data=plugin \
  --exclude-table-data=plugin_method \
  --exclude-table-data='workflow*' \
  | grep -v '^\\restrict \|^\\unrestrict ' \
  > "$output"
