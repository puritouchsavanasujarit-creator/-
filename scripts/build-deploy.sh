#!/usr/bin/env bash
# Build everything needed for a Freebuff Sites deployment.
# Usage: scripts/build-deploy.sh
# Produces deploy/worker.js and deploy/public (assets/aistudio excluded), then
# verifies that both halves carry the same build id and the same scenario ids
# before deploy/manifest.json is published.

set -euo pipefail

cd "$(dirname "$0")/.."

EXCLUDED_PATH="assets/aistudio"
MANIFEST="deploy/manifest.json"

# One id for this whole build: it goes into the worker bundle and into
# deploy/public/build-meta.json, so a stale half fails scripts/verify-build.mjs
# and a mismatched deployment is visible from /api/health.
GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo nogit)"
BUILD_ID="${GIT_SHA}-$(date -u +%Y%m%dT%H%M%SZ)"
export BUILD_ID
echo "==> Build id: ${BUILD_ID}"

# Never let a previous build's worker or assets survive into this one.
rm -rf dist deploy/public deploy/worker.js

echo "==> Building frontend (vite)"
bun run build

ESBUILD_BIN="./node_modules/.bin/esbuild"
if [ ! -x "$ESBUILD_BIN" ]; then
  echo "Missing $ESBUILD_BIN - run: bun install --frozen-lockfile" >&2
  exit 1
fi

echo "==> Bundling worker (esbuild)"
"$ESBUILD_BIN" worker.ts \
  --bundle \
  --format=esm \
  --platform=neutral \
  --target=es2022 \
  --define:__BUILD_ID__="\"${BUILD_ID}\"" \
  --outfile=deploy/worker.js

echo "==> Assembling deploy/public (excluding dist/${EXCLUDED_PATH})"
mkdir -p deploy/public
if command -v rsync >/dev/null 2>&1; then
  rsync -a --exclude "${EXCLUDED_PATH}" dist/ deploy/public/
else
  cp -R dist/. deploy/public/
  rm -rf "deploy/public/${EXCLUDED_PATH}"
fi

echo "==> Writing build stamp"
bun scripts/build-meta.mjs

echo "==> Verifying worker and assets come from this build"
node scripts/verify-build.mjs

if [ ! -f "$MANIFEST" ]; then
  echo "Missing $MANIFEST" >&2
  exit 1
fi

echo "==> Result"
du -sh deploy/public deploy/worker.js
echo "files: $(find deploy/public -type f | wc -l | tr -d ' ')"
echo "ready: $MANIFEST"
echo
echo "Publish $MANIFEST to production with Freebuff Sites (Publish button or Sites deploy tool)."
echo "After publishing, confirm the deployed halves match: node scripts/check-deploy.mjs <base-url>"
