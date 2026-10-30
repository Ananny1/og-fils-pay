#!/bin/sh
# HOST-4: pull-based deploy from GitHub. A systemd timer on the server runs
# this every 2 minutes (ops/prod/filspay-autodeploy.{service,timer}). When
# the tracked branch has a new commit it builds that commit on the server,
# runs the migrations and restarts the stack. The seed is never re-run here
# (Q-7: demo data is loaded once), so data on the box survives deploys.
#
# Pull, not push: the repo is public, so the server needs no GitHub
# credentials and GitHub holds no key to the server.
#
#   sh ops/prod/autodeploy.sh            # deploy if the branch moved
#   sh ops/prod/autodeploy.sh --force    # rebuild and restart anyway
#
# Settings (environment): REPO_DIR (the server's git checkout), DEPLOY_BRANCH
# (default main). Secrets stay in ops/.env.prod, which git ignores.
set -eu
REPO_DIR=${REPO_DIR:-/home/dilmune/filspay-git}
BRANCH=${DEPLOY_BRANCH:-main}
cd "$REPO_DIR"

# One deploy at a time; a timer tick during a long build just skips.
exec 9>"$REPO_DIR/.autodeploy.lock"
flock -n 9 || exit 0

git fetch -q origin "$BRANCH"
NEW=$(git rev-parse "origin/$BRANCH")
OLD=$(cat .deployed 2>/dev/null || true)
if [ "$NEW" = "$OLD" ] && [ "${1:-}" != "--force" ]; then
  exit 0
fi
echo "autodeploy: ${OLD:-none} -> $NEW ($BRANCH)"
git checkout -q --detach "$NEW"

DC="docker compose -f ops/docker-compose.prod.yml --env-file ops/.env.prod"
# Lowest CPU priority: the live site keeps the CPU while the images build.
nice -n 19 $DC build api settlement proxy
$DC up -d --no-build postgres
$DC run --rm --no-deps migrate
$DC up -d --no-build --remove-orphans

# Record the commit only once the API answers healthy again.
i=0
until $DC ps api | grep -q '(healthy)'; do
  i=$((i + 1))
  if [ "$i" -gt 40 ]; then
    echo "autodeploy: api not healthy after deploying $NEW" >&2
    exit 1
  fi
  sleep 3
done
echo "$NEW" > .deployed
echo "autodeploy: live at $NEW"
