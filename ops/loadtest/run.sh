#!/usr/bin/env bash
# Runs ops/loadtest/checkout.js with the grafana/k6 Docker image, attached to
# the stack's `edge` network so it talks to the proxy exactly like a client.
#
#   API_KEY=fp_live_... MERCHANT_ID=<uuid> ops/loadtest/run.sh step
#   API_KEY=...         MERCHANT_ID=...    ops/loadtest/run.sh overload
#
# Env: COMPOSE_PROJECT (default filspay), BASE_URL (default http://proxy),
# plus any checkout.js variable (STEPS, STEP_SECONDS, LINKS, OVERLOAD_VUS).
# Results: ops/loadtest/results/<tag>-summary.json and <tag>-k6.log.
set -euo pipefail

MODE="${1:-step}"
PROJECT="${COMPOSE_PROJECT:-filspay}"
HERE="$(cd "$(dirname "$0")" && pwd)"
RESULTS="$HERE/results"
TAG="${RESULTS_TAG:-$MODE-$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$RESULTS"

: "${API_KEY:?set API_KEY (a merchant API key printed by the seed)}"
: "${MERCHANT_ID:?set MERCHANT_ID (the id of that merchant)}"

docker run --rm -i \
  --network "${PROJECT}_edge" \
  -v "$HERE:/scripts:ro" \
  -v "$RESULTS:/results" \
  -e BASE_URL="${BASE_URL:-http://proxy}" \
  -e API_KEY -e MERCHANT_ID -e MODE="$MODE" -e RESULTS_TAG="$TAG" \
  -e STEPS="${STEPS:-}" -e STEP_SECONDS="${STEP_SECONDS:-}" -e LINKS="${LINKS:-}" \
  -e OVERLOAD_VUS="${OVERLOAD_VUS:-}" \
  grafana/k6:0.54.0 run --quiet /scripts/checkout.js 2>&1 | tee "$RESULTS/$TAG-k6.log"
