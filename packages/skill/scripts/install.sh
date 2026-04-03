#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DEST="$HOME/.claude/skills/agentshow"

mkdir -p "$DEST"
cp "$SKILL_DIR/SKILL.md" "$DEST/SKILL.md"

echo "agentshow skill installed to $DEST"
echo "restart Claude Code to pick it up"
