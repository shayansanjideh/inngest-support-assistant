# Eval details

32 real questions from Inngest's public GitHub issues and Q&A discussions that a maintainer answered. Each answer
is graded 0-2 against the maintainer's reply by a blind judge, against a control (same model, same question, no
sources). Search only sees issues, replies and PRs from before each question's date, and never any eval issue.

| Version | With sources | Plain model | Fully correct | Invented APIs |
|---|---|---|---|---|
| v1 docs + issue text | 1.44 | 1.50 | 15 vs 18 | 0 vs 2 |
| v2 + maintainer replies | 1.28 | 1.47 | 11 vs 16 | 1 vs 1 |
| v3 better queries, no forced hedging (n=30) | 1.43 | 1.40 | 15 vs 16 | 4 vs 3 |
| v4 + merged fix PRs | 1.59 | 1.44 | 20 vs 17 | 4 vs 6 |
| v5 + self-review pass | 1.53 | 1.44 | 18 vs 17 | 3 vs 7 |
| **v6 + source code + Discussions** | **1.69** | 1.53 | **22** vs 19 | **1** vs 3 |

v6 won 6 head-to-heads against the plain model and lost 1 (sign test p ≈ 0.13, not significant at n=32). Of its 21
confident drafts, 19 were fully correct and none were wrong; it cited source code in 18 of 32 answers. The self-review
pass (v5) moved scores within noise, so it is off by default (`REVIEW_STEP=1` turns it on).

Source-code search expects clones of inngest, inngest-js and inngest-py in `../inngest-src` (or set `INNGEST_SRC`).

### What changed between versions

- **v1** searched the docs and GitHub issues, but only read each issue's opening post, not the answer.
- **v2** added the maintainers' replies on matched issues and cut to the best 7 sources. Scores dropped: the prompt
  said to stick to the sources, so the model hedged on things it knew.
- **v3** told the model to use its own knowledge with sources as evidence, and stopped putting "Inngest" in docs
  queries (it matched every page). Back to even with the plain model.
- **v4** added the merged PRs and commits that fixed similar issues, and a precise-then-broad GitHub search.
- **v5** added a self-review pass that re-checks each claim. Within noise, and ~10 s slower, so it's off by default.
- **v6** added Inngest's source code (pinned to the question date) and answered GitHub Discussions. Biggest jump:
  zero wrong answers, and 19 of 21 confident drafts fully correct.

### What I learned

1. **Where the answers live matters more than how much you retrieve.** Docs alone didn't beat a plain model. Many
   real answers (step time limits, ID formats, which steps support rerun) are only in source code or maintainer replies.
2. **How you tell the model to use sources matters as much as the sources.** "Only use the sources" made it hedge and
   score worse than no sources at all.
3. **The confidence score is the most useful output.** It sorted drafts correctly in every version, so a human can
   approve confident ones quickly and spend time on the flagged ones.
4. **Measure every change.** The self-review pass sounded like an obvious win and wasn't. At 32 questions, differences
   under ~0.15 are noise; the plain model alone moved between 1.40 and 1.53 across runs with no code change.

### Reproduce the eval

    npx tsx eval/run.ts && npx tsx eval/grade.ts      # writes eval/answers.json, eval/graded.json
    npx tsx eval/docs_gaps.ts                         # which answers today's docs actually state

### Docs gaps the questions exposed

For each question, today's docs were searched using the maintainer's own answer: 2 of 32 answers were clearly in the
docs, 12 partly, 18 not found (`eval/docs-gaps.json`; model-judged, top pages only).

### Held-out check (13 questions, never used while building)

Answered GitHub Discussions, AgentKit issues and a few inngest-js issues, run once on the final (v6) code with no changes
(`eval/heldout-set.json`, `eval/heldout-graded.json`).

| | With sources | Plain model | Fully correct | Wrong | Invented APIs |
|---|---|---|---|---|---|
| Held-out (n=13) | 1.31 | 1.38 | 4 vs 6 | 0 vs 1 | 2 vs 1 |

Confident drafts: 3 of 7 fully correct, 0 wrong (mean 1.43 vs 1.17 for flagged). The v6 gain over a plain model did
not carry over, so part of it came from tuning on the 32 build questions. Several held-out answers are from 2023 and
the SDK has changed since, which makes grading against them noisier.

### Held-out check 2 (20 bug reports)

The 20 most recent answered bug reports not used before (`eval/heldout2-set.json`, `eval/heldout2-graded.json`), run on
the same code.

| | With sources | Plain model | Fully correct | Wrong | Invented APIs |
|---|---|---|---|---|---|
| Bug reports (n=20) | 1.05 | 1.10 | 1 vs 2 | 0 vs 0 | 3 vs 2 |

It flagged 15 of 20. Of the 5 it marked confident, none were wrong and none fully correct. Bug reports are mostly
partial credit for both: the real fix usually landed after the report, and search can't see past the report's date.
