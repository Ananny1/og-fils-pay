#!/usr/bin/env bash
# Samples `docker stats` for a compose project every INTERVAL seconds until
# killed, as CSV: time,container,cpu%,mem_usage,mem%,restarts
#   ops/loadtest/stats.sh filspay > ops/loadtest/results/stats.csv &
set -uo pipefail
PROJECT="${1:-filspay}"
INTERVAL="${INTERVAL:-5}"
echo "time,container,cpu_pct,mem_usage,mem_pct,restarts"
while true; do
  now=$(date +%H:%M:%S)
  docker stats --no-stream --format '{{.Name}},{{.CPUPerc}},{{.MemUsage}},{{.MemPerc}}' \
    $(docker ps -q --filter "label=com.docker.compose.project=$PROJECT") 2>/dev/null |
  while IFS=, read -r name cpu mem memp; do
    r=$(docker inspect -f '{{.RestartCount}}' "$name" 2>/dev/null || echo "?")
    echo "$now,$name,$cpu,$mem,$memp,$r"
  done
  sleep "$INTERVAL"
done
