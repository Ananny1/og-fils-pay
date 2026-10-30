#!/bin/sh
# Bundles the Node services into plain JavaScript (no tsx, no TypeScript at
# runtime). Native modules (argon2, sharp) stay external and are installed
# as production dependencies in the runtime image (ops/Dockerfile.node.prod).
# Usage, from the repo root inside the build image: sh ops/prod/bundle.sh <outdir>
set -eu
OUT="${1:-dist}"
mkdir -p "$OUT"
# Bundled CommonJS dependencies (fastify, pg, ...) call require(); give the
# ESM bundle a real one.
BANNER='import{createRequire as __fpCreateRequire}from"node:module";const require=__fpCreateRequire(import.meta.url);'
for pair in \
  "api:apps/api/src/index.ts" \
  "reporting:apps/reporting/src/index.ts" \
  "migrate:db/migrate.ts" \
  "seed:db/seed/index.ts" \
  "seed-once:ops/prod/seed-once.ts"; do
  name="${pair%%:*}"
  entry="${pair#*:}"
  npx esbuild "$entry" --bundle --platform=node --target=node20 --format=esm \
    --outfile="$OUT/$name.mjs" \
    --external:argon2 --external:sharp --external:pg-native \
    --banner:js="$BANNER" --log-level=warning
done
# db/migrate.ts reads ./migrations next to its own file.
rm -rf "$OUT/migrations"
cp -r db/migrations "$OUT/migrations"
