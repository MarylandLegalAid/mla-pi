---
name: build
description: Implement a plan. Works through work packages inline by default, in dependency order, delegating to parallel subagents only when packages are genuinely independent and substantial, or would flood context. Gates every package on its tests, commits it locally, then runs one reviewer pass over the whole diff on a different model before reporting. Kills and retries a stuck package once, then stops and reports rather than escalating further. Stops for decision points and manual steps. Use after plan, in a fresh context.
---

# build

Executes `.pi-workflow/plan/`. Keeps going unless genuinely blocked.

Read `shared/preflight.md` from this package root and follow it now. Then read
`shared/artifacts.md` and `shared/plan-shard-schema.md`.

---

## 1. Load and verify

Read `plan/00-overview.md` in full. Skim every shard's frontmatter and Goal line
to see the shape of the whole plan before starting — package count, dependency
graph, wave sizes.

**Validate**: acyclic `depends_on`, every referenced id exists, `owns` disjoint
within each wave, acceptance criteria non-empty. A malformed plan is `plan`'s
defect — **report it and STOP.** Do not repair it and do not work around it.

**Working tree**: if dirty, show the diff summary and ask: commit via
`/skill:yeet` first, stash, or proceed anyway. Must be clean if you intend
`worktree: true` for a delegated wave — pi-subagents requires it.

**Resume**: read `state.json.packages`, announce what is already complete, start
at the first incomplete package. Never redo a `complete` package.

## 2. Work through packages

A wave is every package whose dependencies are all `complete`. Within a wave:

**Default: implement inline**, one package at a time. Read that package's shard
body now — not the whole plan's bodies up front, just the one you're working —
implement its Steps, match the conventions it cites, write and run its tests,
typecheck and lint per the overview's commands, and verify every acceptance
criterion yourself by running it.

**Delegate to `mla-pi.mla-worker` instead** when, for the current wave, two or
more pending packages are independent and each substantial enough to be worth a
fresh context, or a package's own work (large generated code, long exploration)
would flood your context more than the summary you'd get back. Launch every
eligible package in the wave at once:

```
subagent({
  tasks: [ { agent: "mla-pi.mla-worker", model: <roles.worker.model>,
             task: "Implement work package <id>. Read .pi-workflow/plan/00-overview.md
                    and .pi-workflow/plan/<id>.md in full first. You may only create or
                    modify files matching that package's `owns` globs. Throwaway
                    diagnostics go in .pi-workflow/scratch/<id>/, never inside `owns`.
                    Bound every command well under your own command timeout. Verify
                    every acceptance criterion by running it before reporting done." },
           ... ],
  concurrency: <wave size>, context: "fresh",
  timeoutMs: <(shard.timeout_min ?? limits.packageTimeoutMin) * 60000>,
  turnBudget: <limits.turnBudget>, toolBudget: <limits.toolBudget>, control: <limits.control>
})
```

**Set `concurrency` to the wave size** — pi-subagents defaults it to 4, which
would silently cap `limits.maxParallel: 0` (unlimited). Narrate what each
delegated package is doing and summarize its result in a sentence or two when
it lands — do not let delegation go opaque. The gate below is the same
regardless of who wrote the code.

## 3. Gate and commit each package

You verify, never the worker's self-report:

1. **Scope** — changed files are inside `owns`. A violation fails the package.
2. **Tests** for this package, plus the full suite if fast. Typecheck and lint
   repo-wide if the overview names commands for them.
3. **On failure**, fix it yourself (inline) or send the specific findings to a
   fresh `mla-pi.mla-worker` (delegated), once. A second failure on the same
   package: mark `blocked`, continue with independent packages, report at the end.
4. **Read the file list before staging.** `inspect_*`, `test_*`, `tmp_*`, or
   numbered variants of one another are debugging litter that belonged in
   `.pi-workflow/scratch/<id>/` — delete them, say so, never commit them.
5. `git add` only the package's files, then commit:
   `feat(auth): session cookie endpoints [03-auth-endpoints]`. Record the SHA in
   `state.json`. **Never `git push`** — that is yeet's job.
6. `manual: true` packages: stop, print exactly what the user must do and how
   you'll verify it, wait, then re-verify before continuing.

Continue to the next wave. There is no approval gate between waves — only
between a twice-failed package and a `manual` one.

## 4. Runaway detection

Per `config/limits.json`. Catches a stuck agent; does not ration work.

**A timeout is not a test failure.** A failing test tells you what's wrong, so a
retry with those findings can succeed. A timeout only tells you the clock ran
out. On timeout:

1. **Establish what survived** — nothing commits until the gate passes, so the
   working tree still has it. `git status --short`, diff the package's `owns`.
2. **Say what got done**, concretely. "Timed out" alone is not a report.
3. **Judge stuck vs undersized.** Stuck: no real progress, churning diff,
   repeated identical calls — retry once with the findings, like a test
   failure. Undersized: real progress, killed mid-work — **do not retry
   unchanged**, it dies at the same point.
4. **Undersized: ask** — split the package, raise `timeout_min` for this
   package only, take it manual, or skip and mark `blocked`. Never silently
   raise the global `packageTimeoutMin` for one slow package — that removes the
   guard from every other one.
5. **One retry only.** If it also times out or fails, **stop the whole build
   and report**: what was attempted, what stalled, current state, your
   recommendation. A human adjudicates a genuinely stuck package faster than a
   third model would.

`turnBudget`, `toolBudget`, `control.*` are pi-subagents' native loop guards —
pass them on every delegated launch, and watch for the same signals yourself
when working inline. At `softBudgetUsd`, finish the in-flight wave, then ask:
continue / raise / stop. Never abort mid-package. No usage data reported? Say
so once and treat the soft budget as disabled — never estimate.

## 5. Final review

When every package is complete, one reviewer pass over the whole build — not
one per package:

```
subagent({ agent: "mla-pi.mla-reviewer", model: <roles.reviewer.model>, context: "fresh",
           task: "Review the full diff against .pi-workflow/plan/00-overview.md and
                  every package's acceptance criteria. Diff: <git diff <start>..HEAD>." })
```

`reviewer` must not **resolve** to the same model as `worker` — checked after
fallback, not in the config file; preflight already established this. Fix what's
real. Tell the user what was flagged and what you did about it. Disagree with a
finding? Say so and present both positions to the user rather than silently
overruling the reviewer or silently complying.

## 6. Local verification, then close

1. Start the app with the local-dev command. Seed data. **Smoke test for real**
   — `curl` primary endpoints, or drive the primary flow with headless
   Playwright/chrome-devtools. Capture results to `.pi-workflow/log/`.
2. Validate the production path statically (Dockerfile builds, IaC validate/plan
   passes, CI lints). **Never run a deploy** — print the exact command as a
   manual step. Tear down everything you started.
3. Report: packages complete / blocked / skipped, commits made, tests passing,
   smoke results, outstanding manual steps, total cost. Update `state.json`.

```
Next: /skill:yeet
```

---

## Stop conditions

Stop and ask **only** when: a decision was left open or reality contradicts the
plan; a `manual: true` package is reached; a package is blocked after one
retry; the working tree is unexpectedly dirty; the soft budget is crossed; a
deploy or any irreversible/outward-facing action would be required. Otherwise
keep going.

## Hard rules

- Never `git push`. Never deploy. Never create cloud resources.
- Never let work land outside a package's `owns` globs.
- Never mark a package complete on a subagent's say-so, or your own unverified
  claim — run the acceptance commands yourself.
- Never let reviewer and worker share a *resolved* model. Stop instead of
  reviewing anyway.
- Never modify the plan to match the code. If the plan is wrong, stop and say so.
- Never stage a path under `.pi-workflow/` or `.pi-subagents/`. Tracked already?
  `git rm -r --cached` and say so — a `.gitignore` entry does not untrack a
  staged file.
- Never retry a timed-out package unchanged when it made real progress.
- Never raise `limits.packageTimeoutMin` to accommodate one package — use that
  shard's `timeout_min`.
- Never weaken or skip a test to make a package pass.
