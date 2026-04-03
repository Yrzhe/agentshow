#!/bin/bash
set -euo pipefail

PLIST="$HOME/Library/LaunchAgents/com.agentshow.daemon.plist"

launchctl unload "$PLIST" 2>/dev/null || true
rm -f "$PLIST"

echo "agentshow-daemon uninstalled"
