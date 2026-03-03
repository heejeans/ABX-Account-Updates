#!/bin/bash
set -euo pipefail

# Only run in Claude Code remote (web) environments
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"

echo "==> Installing server dependencies..."
npm install --prefix "$PROJECT_DIR"

echo "==> Installing client dependencies..."
npm install --prefix "$PROJECT_DIR/client"

echo "==> Building React frontend..."
cd "$PROJECT_DIR/client" && npm run build

echo "==> Setup complete. Run 'npm start' (in $PROJECT_DIR) to start the server on port 3000."
