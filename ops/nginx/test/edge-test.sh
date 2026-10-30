#!/bin/sh
# SEC-5: prove the edge rules in ops/nginx/ work.
#
#   sh ops/nginx/test/edge-test.sh
#
# Starts three throwaway containers on a private network, all stock
# nginx:1.27-alpine (no build, no running FilsPay service is touched):
#   upstream  fake API, always 200, echoes the client-IP headers it got
#   edge      the front nginx: ops/nginx/test/edge.conf + our two includes
#   client    runs checks.sh (curl) against the edge
# then removes everything again, pass or fail. Needs only docker and the
# nginx:1.27-alpine image; nothing is written to the host.
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
NGINX_DIR=$(cd "$HERE/.." && pwd)
IMAGE=nginx:1.27-alpine
TAG=sec5-edge-$$
NET=$TAG-net

cleanup() {
  docker rm -f "$TAG-upstream" "$TAG-edge" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker network create "$NET" >/dev/null

docker run -d --name "$TAG-upstream" --network "$NET" --network-alias upstream \
  -v "$HERE/upstream.conf:/etc/nginx/conf.d/default.conf:ro" \
  "$IMAGE" sh -c 'mkdir -p /srv/static && head -c 2000000 /dev/zero > /srv/static/big.bin && exec nginx -g "daemon off;"' >/dev/null

EDGE_MOUNTS="-v $HERE/edge.conf:/etc/nginx/conf.d/default.conf:ro -v $NGINX_DIR:/etc/nginx/filspay:ro"

echo "== nginx -t on the edge config"
# shellcheck disable=SC2086
docker run --rm --network "$NET" $EDGE_MOUNTS "$IMAGE" nginx -t

# shellcheck disable=SC2086
docker run -d --name "$TAG-edge" --network "$NET" --network-alias edge $EDGE_MOUNTS "$IMAGE" >/dev/null
sleep 1

status=0
docker run --rm --network "$NET" -v "$HERE/checks.sh:/checks.sh:ro" "$IMAGE" sh /checks.sh || status=$?

echo
echo "== edge access log: floods are visible"
rejected=$(docker logs "$TAG-edge" 2>/dev/null | grep -c 'limit_req=REJECTED' || true)
conn_rejected=$(docker logs "$TAG-edge" 2>/dev/null | grep -c 'limit_conn=REJECTED' || true)
docker logs "$TAG-edge" 2>/dev/null | grep 'limit_req=REJECTED' | head -2
echo "  log lines with limit_req=REJECTED: $rejected, limit_conn=REJECTED: $conn_rejected"
if [ "$rejected" -gt 0 ] && [ "$conn_rejected" -gt 0 ]; then
  echo "  PASS  rejected requests are tagged in the access log"
else
  echo "  FAIL  rejected requests are not tagged in the access log"
  status=1
fi

exit "$status"
