#!/usr/bin/env bash
# Restart only the Express app (the dev server keeps its state).
cd "$(dirname "$0")/.."
pid=$(ss -ltnp 'sport = :3000' | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2); [ -n "$pid" ] && kill "$pid"
sleep 1
DEMO_PASSWORD="${DEMO_PASSWORD:-}" INNGEST_DEV=1 GITHUB_TOKEN="${GITHUB_TOKEN:-$(gh auth token 2>/dev/null)}" nohup npx tsx src/server.ts > app.log 2>&1 &
for i in $(seq 1 30); do curl -s localhost:3000 >/dev/null && break; sleep 1; done
curl -s -X PUT localhost:3000/api/inngest; echo
