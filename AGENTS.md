# Conventions for agents editing this repo

This repo is a pi package. Its product is **markdown that instructs models**, not
documentation for humans — except the README and `docs/`, which address Maryland
Legal Aid (MLA) staff directly. Optimise skill and agent files for a model
following them literally; optimise the README and `docs/` for a reader who may be
new to a terminal.

## Writing skills and agents

- Imperative, numbered procedure. No hedging, no "consider", no "you might".
- State STOP conditions explicitly: what must halt, and what to say when it does.
- Prefer a hard rule over a soft preference. If something must never happen, write
  "Never X" as its own line, not as a clause.
- Keep skill bodies short enough to sit in context comfortably. Shared procedure
  belongs in `shared/*.md`, referenced by relative path — never copy-pasted.
- Every `SKILL.md` `description` must say **what it does and when to use it**.
  That string is all the model sees at startup when deciding whether to invoke.
- Default to inline work over delegation. Spawn a subagent only when the work is
  genuinely parallel, independent, or would flood the main context — not as a
  reflex. A slim, direct instruction beats a scripted subagent invocation with
  every parameter spelled out; trust the model.
- All user-facing text — README, `docs/`, anything a skill prints — assumes no
  git or terminal fluency. Say exactly what to type and what it does.

## Hard rules

- **No npm dependencies.** `scripts/*.mjs` must run on stock Node with zero
  installs. `pi install` runs `npm install` on fresh machines; every dependency is
  a new way for that to fail.
- **Never hardcode a model ID in a skill or agent file.** Routing lives in
  `config/models.json` and is applied via `scripts/apply-models.mjs`. The only
  files that may name a model are `config/models.json`, `README.md`, `docs/`, and
  code comments.
- Model IDs must exist in the authenticated provider's catalog (`pi --list-models`).
- `roles.reviewer` must never resolve to the same model as `roles.worker`. A
  reviewer that shares a model with the implementer is not a second opinion.
- **Cost-effectiveness governs model choice, not open-weight status.** Open-weight
  on OpenRouter is the default for every role in `config/models.json`, but a
  closed/proprietary model is allowed when its capability clearly earns the
  premium — document why in that role's `why` field. Cost is the governing
  constraint for a non-profit; see `docs/admin.md` for how to change it.
- Never commit `.pi-workflow/`.
- **Secret patterns live in `shared/secret-patterns.md` and nowhere else.** `yeet`
  reads it as instructions, `validate.mjs` compiles the same block. Never restate
  the list in a skill — a second copy is a copy that drifts.
- Run `node scripts/validate.mjs` and `npm test` before committing.

## Structure

| Path | Purpose |
|---|---|
| `skills/` | `setup`, `plan`, `build`, `yeet` — declared in `package.json` `pi.skills`. |
| `agents/` | Purpose-built subagents. Declared in `package.json` `pi-subagents.agents`. |
| `extensions/` | `session-splash.js` — the startup header. Declared in `package.json` `pi.extensions`. Layout logic lives in `scripts/session-splash.mjs`, tested; the extension itself is a thin, try/catch-wrapped shell that talks to pi and the machine. |
| `shared/` | Procedure common to several skills. Referenced, not duplicated. |
| `config/` | `models.json` (role routing) and `limits.json` (runaway detection). |
| `catalog/` | `tools.yaml` — the curated tool/MCP inventory `plan` probes. |
| `templates/` | Skeletons for generated artifacts. |
| `test/` | `node --test` suite over `scripts/`. No dependencies. |
| `scripts/` | See below. All zero-dependency, all runnable standalone. |
| `intune/` | Admin-deployed WSL provisioning for Windows staff machines. |
| `docs/` | `admin.md` (John's runbook) and `verification.md` (what's guarded and why). |

| Script | Purpose |
|---|---|
| `bootstrap.sh` | Installs companion packages and applies routing. Called by `install.sh`. Safe to re-run. |
| `validate.mjs` | Checks the **repo**: frontmatter, catalog, references, secrets. `--shards <dir>` also checks a written plan. |
| `doctor.mjs` | Checks the **machine**: packages, agents, resolved models, routing, OpenRouter auth, git/gh identity. |
| `apply-models.mjs` | Writes `config/models.json` into `subagents.agentOverrides` and the `session` role into `defaultProvider`/`defaultModel`. |
| `suggest-models.mjs` | Proposes role→model mapping from the local catalog, filtered to open-weight models. |
| `apply-web-search.mjs` | Defaults pi-web-access to raw results, not the curator. |
| `check-routing-fresh.mjs` | Compares local `config/models.json` against this repo's `main` branch; never blocks offline. |
| `session-splash.mjs` | Pure layout/formatting for the startup header (`extensions/session-splash.js` is the only file that reads the machine). |

`validate.mjs` and `doctor.mjs` are not redundant. A config that validates cleanly
still collapses `worker` and `reviewer` onto one model on a machine whose provider
it does not target — that is a machine fact, invisible to the repo.

## Tests

`npm test` runs `node --test` over `test/*.test.mjs`. No test framework, same
zero-dependency rule as `scripts/`.

The scripts under test are CLIs that read the real machine, so tests **run them as
subprocesses against a fake one** — a stub `pi` (and `gh`) on `PATH`, a temp
`PI_CODING_AGENT_DIR`, a throwaway copy of the repo — rather than importing them.
That is also how they fail in the wild. Helpers are in `test/support/harness.mjs`.

Two rules that are easy to get wrong:

- **Never write a literal secret into a test file.** `validate.mjs` walks the whole
  repo including `test/`, and it is right to. Assemble fixtures at runtime;
  `harness.mjs` exports `fixtures.awsKey()` and `fixtures.pemHeader()` for this.
- **To test "the tool is missing", replace `PATH` wholesale** (`PATH_WITHOUT_PI`).
  Prepending an empty directory leaves the real binary reachable further down and
  silently inverts the test.

Every guard in `validate.mjs`/`doctor.mjs` has a test that proves it fires; see
`docs/verification.md` for the index.

## Companion packages

The skills depend on `pi-subagents`, `@juicesharp/rpiv-ask-user-question`, and
`pi-web-access`. pi does **not** install pi packages transitively, so these are
installed by `scripts/bootstrap.sh` (called from `install.sh`) and verified by
each skill's preflight. Their confirmed APIs are documented in the repo README;
do not guess at schemas — read `~/.pi/agent/npm/node_modules/<pkg>/README.md`.
