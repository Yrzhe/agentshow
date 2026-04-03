#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DAEMON_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DAEMON_MAIN="$DAEMON_DIR/dist/main.js"
PLIST_TEMPLATE="$DAEMON_DIR/com.agentshow.daemon.plist"
PLIST_DEST="$HOME/Library/LaunchAgents/com.agentshow.daemon.plist"
LOG_DIR="$HOME/.agentshow"
NODE_PATH="$(which node)"

if [ ! -f "$DAEMON_MAIN" ]; then
  echo "error: dist/main.js not found. Run 'pnpm build' first."
  exit 1
fi

mkdir -p "$LOG_DIR"
mkdir -p "$(dirname "$PLIST_DEST")"

# Unload existing if present
launchctl unload "$PLIST_DEST" 2>/dev/null || true

# Generate plist from template
sed \
  -e "s|__NODE_PATH__|$NODE_PATH|g" \
  -e "s|__DAEMON_MAIN__|$DAEMON_MAIN|g" \
  -e "s|__LOG_DIR__|$LOG_DIR|g" \
  "$PLIST_TEMPLATE" > "$PLIST_DEST"

launchctl load "$PLIST_DEST"

echo "agentshow-daemon installed and started"
echo "  plist: $PLIST_DEST"
echo "  logs:  $LOG_DIR/daemon.log"
echo "  check: curl http://127.0.0.1:45677/health"
