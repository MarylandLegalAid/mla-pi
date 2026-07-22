# Verification record

This repo is a refit of a personal project (`pi-workflow`) into `mla-pi`, an
org-owned package for Maryland Legal Aid. The engineering lessons below carry
forward from that project's own hard-won debugging; the checks and tests that
encode them were re-verified against this repo's actual code on 2026-07-22,
against pi 0.81.1, pi-subagents 0.35.1, `@juicesharp/rpiv-ask-user-question`
2.0.0, on Ubuntu 24.04. Nothing below is asserted from reading code alone —
each line was executed.

What was **not** re-run under the new name: a live interactive session driving
`/skill:plan`, `/skill:build`, `/skill:yeet` end to end (the prior project's
verification did this for groundwork/blueprint/build under their old names;
those skills no longer exist here in that form). See "Not yet verified" below.

## Passed

| Check | Result |
|---|---|
| `node scripts/validate.mjs --verbose` | valid — 4 skills, 4 agents, 21 catalog entries, 15 cross-references, 10 secret patterns |
| `npm test` | 126 pass, 0 fail — `validate.mjs`, `models.mjs` (apply + suggest), `doctor.mjs`, `shards.mjs`, `check-routing-fresh.mjs`, `install.mjs`, `session-splash.mjs` |
| `bash -n install.sh` / `bash -n scripts/bootstrap.sh` | syntax clean |
| `shellcheck install.sh scripts/bootstrap.sh` | clean |
| `pi install ./` | package registers; `pi list` shows it at the resolved path |
| `node scripts/doctor.mjs` on this machine (not configured for OpenRouter) | correctly reports 4 failures: role models absent from this machine's catalog, reviewer/worker collapsed onto the session model, no OpenRouter key, git identity unset — and 3 warnings, 9 ok. Every failure prints the command that fixes it. |
| `install.sh`'s platform-detection hook (`MLA_PI_TEST_SOURCE=1`) | sourced under fixture `/etc/os-release` files for debian/fedora/arch/unrecognized, with and without the expected package manager on PATH, and a WSL `/proc/version` fixture — all resolve `$FAMILY` correctly (see `test/install.test.mjs`) |
| `scripts/check-routing-fresh.mjs`'s `compare()` | unit-tested directly (fresh/stale/whitespace-insensitive); the CLI's offline path verified against an unreachable host and a malformed URL |

## Known limitation found during verification

**The "mla-pi registered" doctor check can false-warn on a local-path install.**
`pi install git:github.com/<org>/mla-pi` (the real staff path) records a
packages entry containing the literal substring `mla-pi`, which the check
matches. But `pi install ./` from a checkout — what this verification used —
records the relative path to the checkout directory instead (here,
`../../repos/pi-mla`, since the directory is named `pi-mla` not `mla-pi`),
which does not contain that substring. The check is a `warn`, not a `bad`, and
its message ("running from a clone?") is still roughly honest in that case —
but be aware it can warn on a correctly-working local dev install. Not worth
tightening further: real staff never do a local-path install.

## Seeded faults — all caught

Every row below is a test in `test/validate.test.mjs`, `test/models.test.mjs`,
`test/doctor.test.mjs`, or `test/install.test.mjs`, run by `npm test` against a
throwaway copy of the repo or a fake machine. The table is the readable index
of what is guarded; the tests are what prove it still fires.

| Fault | Message |
|---|---|
| `roles.reviewer` = `roles.worker` | reviewer must differ from worker: same model is not a second opinion |
| a role's model org is outside the open-weight allowlist | not on the known open-weight org list - confirm its license |
| a required role (`session`, `scout`, `researcher`, `worker`, `reviewer`) is missing | missing role: \<name\> |
| a role has no matching `agents/mla-<role>.md` file | role \<name\> has no matching agent |
| `sudo: false` + sudo in install | declares sudo: false but its install command uses sudo |
| hardcoded model id in a skill or agent | skills and agents must read config/models.json |
| reference to a nonexistent shared file | references a path that does not exist |
| write tool added to a read-only agent (`mla-scout`/`mla-reviewer`/`mla-researcher`) | read-only agent but declares edit/write in tools |
| agent `package:` field is not `mla-pi` | package must be "mla-pi" to namespace the agent |
| skill frontmatter name mismatch | name must match directory |
| `pi-subagents.agents` removed from manifest | must be `["./agents"]` or the mla- agents will not load |
| npm dependency added | no npm dependencies allowed |
| bare `agent: "mla-worker"` (unnamespaced) | must be namespaced as `mla-pi.mla-worker` or it will not resolve |
| `install_fedora` removed from a debian-family catalog entry | install targets the debian family but has no install_fedora |
| `install_suse:` key added | unknown platform key |
| `AKIA…` key committed | possible AWS access key id committed |
| doctor: no OpenRouter key (env var or `auth.json`) | no OpenRouter key found |
| doctor: `defaultProvider`/`defaultModel` don't match the `session` role | session model applied - config wants \<x\> |
| doctor: `gh auth status` fails or `gh` is missing | not authenticated / gh not on PATH |
| doctor: no global `git config user.name`/`user.email` | user.name and/or user.email not set globally |
| doctor: worker and reviewer resolve to the same model after fallback | reviewer is a second opinion: FAIL |
| `install.sh`: a debian-like ID with no `apt-get` on PATH | resolves to no family rather than a wrong command |
| `pi.extensions` removed from manifest | pi.extensions must be `["./extensions"]` or the startup splash will not load |

## Lessons carried forward from the prior project

These were each found in a real run of the earlier `pi-workflow` project and
are why specific guards exist here. Not re-litigated; kept because the
failure mode is generic to this shape of tool, not to that project's name.

- **A timeout is not a test failure.** A killed subagent that made real
  progress and one that is genuinely stuck need different handling — blind
  retry re-does the writing before it can re-do the running, because retries
  start from a fresh context. `build`'s runaway-detection phase (§4) treats
  them separately: stuck retries once with findings, undersized asks rather
  than retrying blind.
- **A `.gitignore` entry does not untrack what is already staged.** Every
  skill's preflight and `validate.mjs --shards` both check
  `git ls-files --cached` explicitly rather than trusting the ignore file.
- **Package agents resolve only under their namespaced name.** `pi-subagents`
  registers a package agent as `<package>.<name>` and does not alias the bare
  form. `validate.mjs` rejects a bare `mla-worker` reference so this cannot
  regress under the new name either.
- **The tool catalog must be checked per platform family**, not assumed from
  one distro. `validate.mjs` fails a family-bound catalog entry missing a
  sibling command, and `install.sh` and `/skill:plan` both detect the family
  by fact (`command -v`) rather than trusting `/etc/os-release` alone.
- **Debugging scratch work must have a home outside `owns` globs**, or a
  worker's probe scripts get staged and committed by accident. The
  `.pi-workflow/scratch/<pkg-id>/` convention exists for exactly this.

## Not yet verified — needs a live session or a real OpenRouter key

- A full `/skill:plan` → `/skill:build` → `/skill:yeet` run on a real task,
  including: the interview's re-derivation loop actually growing the ledger,
  build's inline-vs-delegate judgment in practice, the single final reviewer
  pass, and yeet asking the main-vs-branch question exactly once and
  remembering it.
- `install.sh`'s full path end to end on a genuinely bare WSL/Ubuntu or
  Fedora/Arch machine — this verification only unit-tested platform
  detection; the package installs, OpenRouter key prompt/validation, git/gh
  identity setup, and final `bootstrap.sh` handoff were not run for real.
- `intune/deploy-wsl.ps1` against an actual Intune-managed Windows device —
  only parsed for syntax validity (`ParseFile`), not executed.
- `scripts/check-routing-fresh.mjs`'s live fresh/stale path against the real
  published repo (this sandbox's child processes cannot reach a server bound
  by the parent test process, so the CLI's fetch behavior was verified only
  against unreachable/malformed URLs; the underlying `compare()` logic is
  unit-tested directly and does not depend on this).
- Real OpenRouter model IDs and prices in `config/models.json` were fetched
  live at write time (2026-07-22) but will drift; see `docs/admin.md` for how
  to refresh them.
- **`extensions/session-splash.js` has never actually run inside pi.** The
  layout/formatting logic in `scripts/session-splash.mjs` is unit-tested
  directly (box width math, the narrow-terminal fallback, the missing-model
  fallback, the pixel-art wordmark's outline/highlight/gradient/shadow
  compositing in both truecolor and 256-color mode), and the extension
  registers via the documented `ctx.ui.setHeader()` pattern from pi's own
  shipped `custom-header.ts` example — but no live `pi` session has rendered
  it. This machine's global `pi` install went missing mid-session (see git
  history / ask John) before that check happened. The wordmark's actual
  *colors* were checked, though not inside a real terminal: its ANSI output
  was converted to HTML and screenshotted (`/tmp/.../scratchpad/splash-preview.html`,
  not saved anywhere durable) to confirm the gradient/outline/shadow render
  as intended — but a real terminal's font, line-height, and color-mode
  detection could still differ. Before rollout: start `pi` in a real terminal
  at a normal width, a narrowed width, with `OPENROUTER_API_KEY` unset, and
  with `quietStartup: true`, and confirm each renders as expected.

Suggested first real run once a staff OpenRouter key exists: something small
enough to inspect end to end, e.g. a one-endpoint health-check service with a
test and a Dockerfile.
