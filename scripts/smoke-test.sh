#!/usr/bin/env bash
set -Eeuo pipefail

BASE_URL="\${BASE_URL:-http://127.0.0.1:3000}"
BASE_URL="\${BASE_URL%/}"

echo "Checking health endpoint..."
health="$(curl --fail --silent --show-error "\${BASE_URL}/healthz")"
printf '%s\n' "$health"
printf '%s' "$health" | grep -q '"ok":true'

echo "Checking game HTML..."
html="$(curl --fail --silent --show-error "\${BASE_URL}/gs2c/html5Game.html")"
printf '%s' "$html" | grep -q 'SESSION@'
if printf '%s' "$html" | grep -q 'teucuman-production.up.railway.app'; then
  echo "ERROR: game page still points to the old Railway host" >&2
  exit 1
fi

echo "Checking local game loader..."
curl --fail --silent --show-error --output /dev/null \
  "\${BASE_URL}/gs2c/common/js/html5-script-external.js"

echo "PASS: Teucuman HTTP smoke test completed."
