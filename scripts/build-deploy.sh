#!/usr/bin/env bash
# Build everything needed for a Freebuff Sites deployment.
# Usage: scripts/build-deploy.sh
# Produces deploy/worker.js and deploy/public (assets/aistudio excluded),
# then deploy with the manifest at deploy/manifest.json.

set -euo pipefail

cd "$(dirname "$0")/.."

EXCLUDED_PATH="assets/aistudio"
MANIFEST="deploy/manifest.json"

echo "==> Building frontend (vite)"
bun run build

echo "==> Bundling worker (esbuild)"
bunx esbuild worker.ts \
  --bundle \
  --format=esm \
  --platform=neutral \
  --target=es2022 \
  --outfile=deploy/worker.js

echo "==> Assembling deploy/public (excluding dist/${EXCLUDED_PATH})"
rm -rf deploy/public
mkdir -p deploy/public
if command -v rsync >/dev/null 2>&1; then
  rsync -a --exclude "${EXCLUDED_PATH}" dist/ deploy/public/
else
  cp -R dist/. deploy/public/
  rm -rf "deploy/public/${EXCLUDED_PATH}"
fi

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
