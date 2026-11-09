#!/bin/sh
ROOT="$(cd "$(dirname "$0")" && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "Node is not installed. Install Node 24 or newer from https://nodejs.org and run this again." >&2
  exit 1
fi
if ! node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 24 ? 0 : 1)"; then
  echo "Node 24 or newer is required; found $(node -v)." >&2
  exit 1
fi

if [ ! -d "$ROOT/node_modules" ]; then
  npm --prefix "$ROOT" install || exit 1
fi

exec node "$ROOT/scripts/start.ts" --open "$@"
