---
name: plan
description: Turn a goal into tooling plus a comprehensive, decision-free implementation plan, in one conversation. Works out what CLIs and MCP servers the task needs and installs what it safely can, then interviews you one multiple-choice question at a time until every open decision is resolved, and writes a sharded plan with a dependency graph that build can execute. Use at the start of any new project or feature request, before build.
---

# plan

Produces `.pi-workflow/plan/`, containing **no decisions for the implementing
engineer** and nothing about tooling still unresolved.

Read `shared/preflight.md` from this package root and follow it now. Then read
`shared/asking.md`, `shared/artifacts.md`, and `shared/plan-shard-schema.md`.

If `plan/` already exists, go to **Amend mode** at the end of this file first.

---

## 1. Orient

Restate the goal in 2-3 sentences. On a brownfield repo, delegate a quick recon:

```
subagent({ agent: "mla-pi.mla-scout", model: <roles.scout.model>, context: "fresh",
           output: ".pi-workflow/research/codebase.md",
           task: "Map this repository for a change to: <goal>. Cover stack, testing,
                  quality gates, layout, existing patterns in the target area with
                  file:line citations, build and deploy, and anything fragile." })
```

Reuse an existing `codebase.md` if newer than the last commit touching the
relevant area. Skip entirely on greenfield.

## 2. Tooling

Work out what this task needs before interviewing about it — a wrong or missing
tool changes the answers.

1. Match the goal's domain against `catalog/tools.yaml` `domains`. For anything
   the catalog does not cover, research it (§4) rather than guessing an install
   command.
2. **Detect the platform before naming a command:**

   ```sh
   . /etc/os-release && echo "$ID ${ID_LIKE:-}" && uname -m
   ```

   Map `ID`/`ID_LIKE` to a family — `debian` (debian, ubuntu, linuxmint, pop),
   `fedora` (fedora, rhel, centos, rocky, almalinux), `arch` (arch, manjaro,
   endeavouros) — then **confirm by fact**: `command -v` for that family's
   package manager. What is actually on PATH wins over what `/etc/os-release`
   claims. Unknown family, or the expected manager absent: say so, and treat
   every catalog command as unresolved.
3. Resolve each candidate's install command: `install_<family>` first, else the
   bare `install` only if the package manager it names is present, else
   unresolved — research it (§4), never adapt a command by swapping package
   managers.
4. Run every candidate's `detect` (and `auth_check` where present). Nothing else
   — no installs, no auth, nothing interactive.
5. **One consent question**, `multiSelect: true`, previewing the whole table
   (tool · why · scope · command · sudo). Not selected = declined.
6. Install: `sudo: false` → run it directly. `sudo: true` → **never run it**;
   collect every sudo command into one block and hand it to the user to run
   elsewhere, then re-probe — "done" is not proof, the detect command is.
   `MANUAL` → print `install_notes`. Loop until every candidate is
   installed/present/declined/failed. **Never exit with anything unknown** —
   build assumes this section of the plan is true.

Fold the result straight into `00-overview.md`'s Tooling section (§5) — no
separate document.

## 3. Interview

Seed `state.json.openDecisions` from what's genuinely undetermined: scope and
non-goals, data model, auth, external integrations, hosting/deploy target, local
dev story, testing strategy, error handling, observability, migrations, UX
flows, performance/cost/quota limits, secrets, rollout/rollback. Drop anything
the codebase or the tooling step already settles.

Loop, per `shared/asking.md`:

1. Pick the open decision that most constrains the others. Architecture first.
2. **Research before asking** anything touching a library, service, or API —
   see §4.
3. Ask via `ask_user_question`: one question, 2-4 options, real tradeoffs, one
   `(Recommended)` first.
4. Record the answer and any `notes` — notes are authoritative.
5. **Re-derive the whole ledger.** Add what the answer implies, mark moot what
   it eliminates, rephrase what it reframes. Print `ledger: N resolved · M open`.

**Exit only when a full re-derivation pass adds nothing new and no decision is
open** — not at a question count, not when it "seems clear enough". A small
task might resolve in three questions; a new app might take twenty. If the user
needs to pause, say how much remains — `state.json` makes this resumable.

Present the complete resolved ledger and confirm before writing anything.

## 4. Research

The rule both §2 and §3 lean on: when a decision depends on external fact —
library capability, service limit, price, API shape — verify it, do not recall
it. A quick fact is a direct `web_search`/`fetch_content` call. Anything needing
several sources or real documentation reading:

```
subagent({ agent: "mla-pi.mla-researcher", model: <roles.researcher.model>,
           task: "<the specific question, and the criteria to compare against>" })
```

Save citations to `.pi-workflow/research/<topic>.md`. Options reflect what is
true now, fetched — never recalled.

## 5. Write the plan

Decompose into work packages yourself — no delegation, you hold the full
ledger. Per `shared/plan-shard-schema.md`:

- `owns` globs disjoint within each wave — what makes parallel build safe.
- Acceptance criteria are checkable commands or named observable behaviour.
- 100-400 lines of expected diff per package; split anything bigger.
- **Split writing from running** for anything hitting a third party (scraping,
  bulk imports, live migrations): one package writes it and tests it against
  recorded fixtures; a separate package with `network: true` and a real
  `timeout_min` runs it live. The default 25-minute budget will kill an
  undersized package mid-run, and the retry starts from a fresh context.
- Include unless the ledger rules them out: local-dev command + smoke check,
  test harness if absent, CI if absent, production path (Dockerfile/IaC,
  statically validated, **never executed**), and a `manual: true` shard for
  anything only the user can do (DNS, provisioning, secrets, licensing).

Write `plan/00-overview.md` from `templates/plan-overview.md.tmpl` — goal,
architecture, full ledger, cited conventions, the tooling table from §2, the
environment commands, the package table, wave ordering. Write each shard from
`templates/plan-shard.md.tmpl`.

**Check your own work** before closing: `node scripts/validate.mjs --shards
.pi-workflow/plan` catches acyclic `depends_on`, checkable acceptance criteria,
and the network/timeout invariant mechanically. Re-read the wave grouping
yourself for disjoint `owns` — the one invariant nothing scripted checks — and
fix anything you find. Re-run until clean.

## 6. Close

Update `state.json`. Print the package count and wave plan, then:

```
Next: clear context, then /skill:build
```

---

## Amend mode

If `plan/` already exists, ask which:

- **resume** — the ledger still has open items; continue the interview
- **amend** — a new goal on top of an existing plan. Add packages with **new
  ids**, `depends_on` referencing completed ones. **Never renumber existing
  shards** — build's `state.json` keys off those ids.
- **restart** — archive to `plan.archived-<timestamp>/` first. Never delete.

---

## Hard rules

- **Never execute a command containing `sudo`.** Print it; the user runs it.
- **Never offer or run an install command for a package manager this machine
  does not have.**
- Never run an install that prompts interactively, or an `auth`/login command.
- Never write a plan while a decision is open, or leave "TBD", "consider", or an
  unresolved either/or in a shard.
- Never state a library version, API signature, or price without having fetched
  it.
- Never ask what is already answered in `codebase.md`, the tooling table, or
  the ledger.
- Never skip the re-derivation pass after an answer.
- Never let a package's acceptance depend on a third party without
  `network: true` and a real `timeout_min`. A gate as flaky as someone else's
  uptime is a gate everyone learns to ignore.
