#!/usr/bin/env bash
# Local dev: Inngest dev server (bound to localhost only) + the Express app.
cd "$(dirname "$0")"
export INNGEST_DEV=1
nohup npx inngest-cli@latest dev --host 127.0.0.1 -u http://localhost:3000/api/inngest --no-discovery > dev.log 2>&1 &
export GITHUB_TOKEN="${GITHUB_TOKEN:-$(gh auth token 2>/dev/null)}"
# Source-code search expects clones of inngest, inngest-js, inngest-py in ../inngest-src (INNGEST_SRC to override).
nohup npx tsx src/server.ts > app.log 2>&1 &
