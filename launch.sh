#!/usr/bin/env bash
# Start the local iEdit site for a manual check.
set -euo pipefail

cd "$(dirname "$0")"

if [[ ! -d node_modules ]]; then
  npm install
fi

echo "iEdit dev server: http://localhost:5173"
exec npm run dev -- --host 127.0.0.1 --port 5173
