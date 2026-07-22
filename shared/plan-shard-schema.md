# Plan shard schema

The contract between `plan` (writes) and `build` (executes). A shard is one
work package: a unit of work a single subagent can complete in one context window,
starting from nothing but this file and `00-overview.md`.

## Frontmatter

```yaml
---
id: 03-auth-endpoints          # NN-slug. Matches the filename. Unique. Never renumbered.
depends_on: [01-db-schema]     # ids only. Must form a DAG. [] for roots.
owns:                          # glob paths this package may create or modify
  - src/api/auth/**
  - tests/api/auth/**
acceptance:                    # objectively checkable. A command or an observable fact.
  - "POST /login returns 200 and sets an httpOnly session cookie"
  - "pnpm test tests/api/auth passes"
manual: false                  # true => the user must do it; build stops and hands over
network: false                 # true => acceptance needs third-party I/O. See "Runtime".
timeout_min: 45                # optional. Overrides limits.packageTimeoutMin for this package.
---
```

## Body

All five sections are required, in this order.

### Goal
One paragraph. What exists when this package is done, in the past tense.

### Context
Everything a fresh agent needs that is not in `00-overview.md`:
- the exact libraries and versions decided in the interview
- existing conventions this code must match, cited as `file.ts:42` from
  `research/codebase.md` — quoted, not summarised
- the shape of adjacent code it will call or be called by
- environment variables, config keys, secrets it needs (names, never values)

### Steps
Numbered and concrete. Name the files, functions, routes, types, and env vars.
An implementer should never have to choose between two reasonable options.

### Tests
What to write, where it goes, and the exact command that runs it.

### Out of scope
What this package must **not** touch, especially anything owned by a sibling
package in the same wave.

## Runtime

Invariant 5 sizes a package by its **diff**. That measures writing, not running,
and the two come apart hard for anything that talks to a third party: scraping,
crawling, bulk API imports, migrations over real data. A package can be 200 lines
and still take hours, because rate limits, pagination, backoff and someone else's
uptime are not yours to control.

So:

- **Split writing from running at scale.** The scraper, its parser, and unit tests
  against **recorded fixtures** are one package — fast, deterministic, offline. The
  live crawl is a separate package.
- **The live-run package sets `network: true`**, and either `timeout_min` sized to
  the real job or `manual: true` if the honest answer is "this runs for an hour and
  a human should watch it".
- **Never make a fast package's acceptance depend on a third party.** A criterion
  that hits a live site makes the review gate as flaky as that site, and a build
  that fails for someone else's downtime teaches everyone to ignore the gate.

`timeout_min` overrides `limits.packageTimeoutMin` for that package only. Use it
when the work is genuinely long, not to paper over a package that should be two.
Raising the global ceiling to fit one slow package removes the runaway guard from
every other package in the plan.

**Say in the shard what the target's shape is**, for anything scraped or parsed:
the selectors, the endpoints, the pagination scheme, whether the content is
server-rendered. A worker that has to reverse-engineer a page's DOM will do it by
writing one probe script per hypothesis, and each probe costs a full page load. That
is discovery work, and discovery belongs in plan's research — cited in the
shard's Context — not in a timeboxed implementation package.

## Invariants

`plan` enforces these before writing; `build` re-checks before executing;
`node scripts/validate.mjs --shards <plan-dir>` checks a written plan.

1. **`owns` globs are disjoint across packages in the same wave.** Two agents
   editing the same file concurrently is the failure mode sharding exists to
   prevent. Overlap between different waves is fine — they are ordered.
2. **`depends_on` is acyclic**, and every id it names exists.
3. **No open questions.** No "decide whether", no "TBD", no "consider", no
   either/or left to the implementer. If plan cannot resolve something, it is
   an open decision and the interview is not finished.
4. **Every acceptance criterion is checkable** by running a command or observing a
   specific, named behaviour. "Code is clean" is not a criterion.
5. **Size:** roughly 100-400 lines of resulting diff. A package that cannot be
   described in one shard is two packages.
6. **`manual: true` packages have no `owns`** and their acceptance criteria
   describe what the user will have done, plus how build verifies it afterwards.
7. **`network: true` packages declare `timeout_min` or are `manual: true`.** A
   package whose acceptance depends on a third party and inherits the default
   25-minute budget is a timeout waiting to happen — and the retry starts from a
   fresh context, so it re-does the writing before it can re-do the running.
8. **`timeout_min`, when present, is a positive integer.** It is minutes, not
   milliseconds.
