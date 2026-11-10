# Support Brain

A support assistant built on [Inngest](https://www.inngest.com). A question comes in (typed, or a pasted GitHub issue
link). One Inngest function searches the docs, GitHub issues, discussions, fix PRs and Inngest's source code in parallel,
drafts a cited answer with a confidence rating, and pauses on `step.waitForEvent` until a human approves or edits it.
Nothing is sent without that click.

## Tested on 65 real questions

Answered questions and bug reports from Inngest's public GitHub, graded against the maintainer's actual reply:
32 used while building, then 33 held out until the end (13 questions, 20 bug reports).

- **It was never wrong.** 0 of 65 answers were graded wrong. A plain model with no sources was wrong 3 times.
- **Confident drafts are safe.** None of the 33 drafts it marked confident were wrong, and 22 were fully correct.
  The rest arrive flagged, with a one-line reason.
- **It isn't smarter than a plain model on average.** On the 33 held-out items it scored about the same as a plain
  model, so the bigger gain on the 32 build questions partly reflects tuning on them. The value is in the workflow:
  cited sources, a reliable "don't trust this one" flag, and nothing sent without a human.
- **Bug reports get triaged, not solved.** On 20 bug reports it flagged 15 and mostly found the right area without
  the actual fix, which usually landed in a PR after the report.

Method and per-version numbers: [EVAL.md](docs/EVAL.md).

## Docs gaps it found

- Rerun from step only works for `step.ai.infer` / `step.ai.wrap` ([#2104](https://github.com/inngest/inngest/issues/2104))
- A single step has a hard 2-hour limit ([#2216](https://github.com/inngest/inngest/issues/2216))
- "Payload too large" usually comes from your own server's body limit ([#2016](https://github.com/inngest/inngest/issues/2016))
- String values in a `waitForEvent` `if` need quotes ([#2030](https://github.com/inngest/inngest/issues/2030))

## Friction log

Built with Claude Code. What would have made it easier:

- SDK v4 fails with "In cloud mode but no signing key found" until `INNGEST_DEV=1` is set. Worth putting in the quick start.
- `inngest dev` listens on all interfaces, so on a VPS it was public until I added `--host 127.0.0.1`.
- `GET /v1/runs/:id` returned an empty output and a cached status while GraphQL had the real result.

More in [FRICTION.md](docs/FRICTION.md).

## How it works

```
clean-up-question → search-docs ‖ search-github-issues ‖ search-discussions ‖ search-fix-prs ‖ search-source-code
  → draft-answer → post-draft-for-review → step.waitForEvent("support/draft.reviewed") → send-answer
```

The whole pipeline is one function in [`src/functions.ts`](src/functions.ts).

- Approval gate: `step.waitForEvent` matched on the thread ID, so only that thread's Approve/Edit click resumes the run
- The five searches are parallel `step.run`s; a failure retries only that search
- Model calls run in `step.ai.wrap`, so their inputs show in the trace and "Rerun from step" works on them
- Typed events (`eventType` + a zod schema): payloads are checked at compile time, and `inngest.send` rejects invalid ones
- Per-thread concurrency and a 5 s debounce (a question sent as several messages becomes one run)
- Retries on every step, with `RetryAfterError` timed to GitHub's rate-limit reset
- The demo page's thread state is in memory; Inngest holds the durable run state

## Run it

Needs Node 22, the GitHub CLI and the Claude Code CLI logged in (model calls go through `claude -p`; swap `src/llm.ts`
for an API client or `step.ai.infer` to run it as a service). Source-code search expects clones of inngest, inngest-js
and inngest-py in `../inngest-src`.

    npm install
    npm run fetch-docs
    ./dev.sh                 # Inngest dev server on 127.0.0.1:8288, app on http://127.0.0.1:3000
