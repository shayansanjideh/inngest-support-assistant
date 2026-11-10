# Friction log

I built this with Claude Code doing most of the typing, so this is what slowed down an AI-assisted build on a fresh
VPS. Each item says what happened and what would have made it easier.

**1. SDK v4 starts in cloud mode.**
The app failed on the first request with "In cloud mode but no signing key found" until I set `INNGEST_DEV=1`.
Easier: have `serve()` default to dev mode when the dev server is reachable on localhost, or put `INNGEST_DEV=1`
in the first code block of the quick start.

**2. `inngest dev` listens on every interface.**
On a VPS with no firewall, the dev server and its UI were reachable from the internet until I added
`--host 127.0.0.1`.
Easier: bind to 127.0.0.1 by default, with a flag to open it up.

**3. The REST run endpoint and the dev UI disagreed.**
`GET /v1/runs/:id` returned `output: ""` and a cached "Completed" status, while the dev server's GraphQL had the
real output. I lost time thinking `waitForEvent` had resolved early.
Easier: return the run output over REST, or document the cache window on that endpoint.

**4. Code outside steps re-runs on every replay.**
A status update I wrote just after a step ran twice once the function resumed from `waitForEvent`. This is
documented, and the fix (move side effects into `step.run`) is one line, but it's the easiest mistake to make, and
one of the 32 GitHub questions in my eval (inngest#3069) is the same confusion.
Easier: a dev-server warning when code outside steps runs again on a replay.

**5. What worked well.**
`llms-full.txt` made the docs search a single short file. `step.waitForEvent` with `match` was exactly the
human-approval gate I needed, and `RetryAfterError` let me retry GitHub's rate limits at the right time instead of
guessing a backoff.
