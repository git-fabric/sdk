#!/bin/bash
# Integration test runner
# Uses existing Redis on localhost:6379, starts gateway + bridge, runs tests
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SDK_DIR="$(dirname "$SCRIPT_DIR")"
PIDS=()

cleanup() {
  echo ""
  echo "[runner] Cleaning up..."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  done
  echo "[runner] Done."
}
trap cleanup EXIT

echo "=== Fabric-SDK Integration Runner ==="
echo ""

# Check prerequisites
if [ -z "$GITHUB_TOKEN" ] && [ -z "$GIT_STEER_TOKEN" ]; then
  echo "[runner] GITHUB_TOKEN or GIT_STEER_TOKEN required"
  echo "         export GITHUB_TOKEN=ghp_..."
  exit 1
fi

# Check Redis
if ! redis-cli ping >/dev/null 2>&1; then
  echo "[runner] Redis not running on localhost:6379"
  echo "         brew services start redis  OR  docker run -d -p 6379:6379 redis:7.2-alpine"
  exit 1
fi
echo "[runner] Redis: up"

# Start gateway
echo "[runner] Starting gateway on :7340..."
cd "$SDK_DIR"
npx tsx packages/gateway/src/index.ts &
PIDS+=($!)
sleep 2

# Start bridge
echo "[runner] Starting git-steer bridge on :8200..."
BRIDGE_PORT=8200 npx tsx "$SCRIPT_DIR/git-steer-bridge.ts" &
PIDS+=($!)
sleep 1

# Run tests
echo ""
npx tsx "$SCRIPT_DIR/test-routing.ts"
