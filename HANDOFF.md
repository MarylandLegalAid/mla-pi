# Handoff

The refit described in the interview-derived plan is implemented. This file is
what to check before rollout; delete it once you have.

## Before this goes live

1. **Do the `<MLA-ORG>` find-replace.** Nine files still carry the literal
   placeholder — `grep -rl '<MLA-ORG>' . --exclude-dir=.git` finds them
   (`README.md`, `package.json`, `install.sh`, `scripts/doctor.mjs`,
   `scripts/check-routing-fresh.mjs`, `intune/deploy-wsl.ps1`, `docs/admin.md`,
   `test/doctor.test.mjs`). `docs/admin.md` §1 has the exact command. Do this
   after creating the real GitHub org and repo, then commit it as its own change.
2. **Review the model picks in `config/models.json`** (table below) — these are
   real, current OpenRouter IDs and prices as of 2026-07-22, but you're the one
   who should sign off on the cost/quality tradeoff before staff start using them.
3. **Get an OpenRouter account and issue yourself a test key**, then run
   `node scripts/doctor.mjs` for real (not against a fixture) to see it pass
   end to end — this was verified against fake machines in `test/`, not against
   a live OpenRouter-authenticated session.
4. **Run the real install flow once**, ideally on a spare or VM'd machine, not
   this one — `install.sh` was verified for syntax and for its platform-detection
   logic in isolation (`test/install.test.mjs`), but the full flow (package
   installs, the OpenRouter key prompt, git/gh identity setup) has not been run
   for real. See `docs/verification.md` for exactly what has and hasn't been
   exercised.

## What changed, in one paragraph

Four skills became three (`plan` merges the old groundwork+blueprint; `build`
and `yeet` were rewritten, not just renamed) plus `setup`. Six agents became
four (`mla-scout`, `mla-researcher`, `mla-worker`, `mla-reviewer` — the planner
and scribe roles are gone; planning and doc-writing happen inline now).
Model routing moved from a fixed `opencode-go` provider to OpenRouter,
open-weight-only, with a new `session` role that sets pi's own default model
instead of an agent override. `build` defaults to working inline and delegates
only when it helps; the per-package reviewer became a single end-of-build
review. `yeet` now asks main-vs-branch once per repo (`git config
mla.yeet-target`) instead of assuming main. A turnkey `install.sh` and an
Intune WSL-deployment script (`intune/deploy-wsl.ps1`) are new. Full rationale
for every one of these is in `docs/verification.md`'s "lessons carried
forward" and the original interview transcript this was built from.

## Verify-don't-guess items — what was actually checked

Everything below was confirmed against the real, installed pi 0.81.1 on the
machine this was built on (`@earendil-works/pi-coding-agent`, via
`npm install -g`), not assumed from documentation alone:

| Item | Finding |
|---|---|
| pi's install method | `npm install -g @earendil-works/pi-coding-agent` — confirmed against the actual global npm install on the reference machine, and cross-checked against `npm view`. |
| How pi stores OpenRouter credentials | Built-in provider. `OPENROUTER_API_KEY` env var, or `~/.pi/agent/auth.json` → `{"openrouter": {"type": "api_key", "key": "..."}}`. Confirmed from pi's own `docs/providers.md` shipped with the install. |
| How pi stores the default/session model | `~/.pi/agent/settings.json` → `defaultProvider` / `defaultModel` (bare id, no provider prefix) / `defaultThinkingLevel`. Confirmed from `docs/settings.md` and this machine's actual settings file. |
| OpenRouter model ID shape for `provider/id`-style routing | `<provider>/<org>/<model>` for `subagents.agentOverrides` (three segments, since OpenRouter's own ids already contain a slash); bare `<org>/<model>` for `defaultModel`. Confirmed from `docs/settings.md`'s OpenRouter example and pi's `model-resolver.js`. |
| pi-subagents' current option shapes (`timeoutMs`, `control`, `concurrency`, agent frontmatter fields) | Read directly from the installed `pi-subagents` README (`~/.pi/agent/npm/node_modules/pi-subagents/README.md`), version 0.35.1. |
| Current OpenRouter open-weight model catalog and pricing | Fetched live from `GET https://openrouter.ai/api/v1/models` (342 models) at write time — see table below. |

## Model picks — review before rollout

All open-weight, per the org's cost policy. Fetched live from OpenRouter on
2026-07-22; prices and availability drift, so treat this table as a snapshot,
not a promise — `docs/admin.md` covers how to change these.

| Role | Model | Context | Price in/out per M tokens | Why |
|---|---|---|---|---|
| `session` | `deepseek/deepseek-v4-pro` | 1,048,576 | $0.435 / $0.870 | Strongest open-weight generalist at this price; drives the interview and inline build work. |
| `scout` | `deepseek/deepseek-v4-flash` | 1,048,576 | $0.098 / $0.196 | Cheapest capable model; codebase recon is a recall task. |
| `researcher` | `qwen/qwen3.6-flash` | 1,000,000 | $0.188 / $1.125 | Mid-tier, priced between scout and session; large context for synthesizing many sources. |
| `worker` | `qwen/qwen3-coder-next` | 262,144 | $0.110 / $0.800 | Code-specialized, cheap, large max output for multi-file diffs. |
| `reviewer` | `z-ai/glm-4.7` | 204,800 | $0.400 / $1.750 | Z.ai/Zhipu — a different lab from worker's Qwen/Alibaba family, so review is a genuine second opinion. |

## Deliberate scope decisions, if you revisit this later

- The `.pi-workflow/` artifacts directory keeps its name from the prior
  project — it's an internal, gitignored implementation detail, not
  user-facing branding, so renaming it wasn't worth the churn.
- `scripts/apply-models.mjs` writes agent overrides under both `mla-<role>`
  and `mla-pi.mla-<role>` — this dual-write exists because a prior version of
  this project found package agents resolve only under their namespaced form
  at runtime (see `docs/verification.md`). Don't simplify this away without
  re-confirming against whatever pi-subagents version is current then.
- `doctor.mjs`'s "mla-pi registered" check can false-warn on a local-path
  `pi install ./` (see `docs/verification.md`'s "known limitation"). Not worth
  fixing — real staff always install via the git form, which it detects correctly.
