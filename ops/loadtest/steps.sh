#!/bin/sh
# CAP-1: run the checkout scenario at fixed user counts, one after the other.
#   sh ops/loadtest/steps.sh <run> <duration> <vus...>
# Links plink_lt_<run>_* must exist (make-links.sql); each step uses its own
# block of 10000 links. Prints the key k6 numbers per step.
set -eu
RUN=$1; DURATION=$2; shift 2
BASE=${BASE:-http://localhost:8080}
OFFSET=${OFFSET:-0}
for VUS in "$@"; do
  echo "=== ${VUS} users, ${DURATION} (links from ${OFFSET})"
  docker run --rm --network host -v "$(pwd)/ops/loadtest:/lt" grafana/k6:0.54.0 run --quiet \
    -e BASE="$BASE" -e RUN="$RUN" -e PROFILE=steady -e VUS="$VUS" -e DURATION="$DURATION" -e OFFSET="$OFFSET" \
    /lt/checkout.js 2>&1 | grep -E "checkout_ok_ms|pay_paid|pay_declined|pay_shed|pay_wrong|shed_ms|shed_without" || true
  OFFSET=$((OFFSET + 10000))
  sleep 5
done
