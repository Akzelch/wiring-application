#!/bin/sh
ROOT="$(cd "$(dirname "$0")" && pwd)"

if pkill -f "node $ROOT/scripts/start.ts"; then
  echo "Wiring Application stopped."
else
  echo "Wiring Application is not running."
fi
