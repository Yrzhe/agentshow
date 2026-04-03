---
name: agentshow
description: See what your AI agent sessions are doing. View active Claude Code sessions, token usage, shared notes, and session history. Use when asked about peers, active sessions, agent activity, what other agents are doing, or session stats.
---

# AgentShow

AgentShow monitors your Claude Code sessions automatically via a local daemon. Use these commands to check session status, share notes, and view history.

## Prerequisites

The AgentShow daemon must be running on `localhost:45677`. If commands return connection errors, start it with:

```bash
cd <agentshow-repo> && pnpm build && ./packages/daemon/scripts/install.sh
```

## Commands

### /peers

View all active Claude Code sessions and what they are working on.

**Execute:**
```bash
curl -s http://127.0.0.1:45677/sessions?status=active | python3 -m json.tool
```

### /sessions

View all sessions (active, discovered, ended).

**Execute:**
```bash
curl -s http://127.0.0.1:45677/sessions | python3 -m json.tool
```

### /stats

View token usage and stats for a specific session. Replace `SESSION_ID` with the actual session ID.

**Execute:**
```bash
curl -s http://127.0.0.1:45677/sessions/SESSION_ID/stats | python3 -m json.tool
```

To see stats for the current session, first find your session ID from `/peers`, then query its stats.

### /projects

View all projects with active session counts and total token usage.

**Execute:**
```bash
curl -s http://127.0.0.1:45677/projects | python3 -m json.tool
```

### /history

View ended sessions.

**Execute:**
```bash
curl -s http://127.0.0.1:45677/sessions?status=ended | python3 -m json.tool
```

### /health

Check if the daemon is running.

**Execute:**
```bash
curl -s http://127.0.0.1:45677/health | python3 -m json.tool
```
