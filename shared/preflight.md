# Preflight

Every mla-pi skill runs this first. Do not skip steps. Do not proceed past a STOP.

## 1. Capability check

Confirm the tools you need are actually available in this session:

| Capability | Tool | Package |
|---|---|---|
| Structured questions | `ask_user_question` | `@juicesharp/rpiv-ask-user-question` |
| Delegation | `subagent` | `pi-subagents` |
| Web research | `web_search`, `fetch_content` | `pi-web-access` |

If `ask_user_question` or `subagent` is missing, print exactly this and **STOP**:

```
mla-pi needs a companion package that is not installed:

  pi install npm:pi-subagents
  pi install npm:@juicesharp/rpiv-ask-user-question

Restart pi afterwards, then run this skill again.
```

Never fall back to asking questions as plain text, and never fall back to doing a
subagent's work inline. A degraded text interview is the exact experience this
workflow exists to replace — stopping is the correct behaviour.

**Exception:** if only `pi-web-access` is missing, warn once
(`web research unavailable - install with: pi install npm:pi-web-access`) and
continue with reduced research.

## 2. Load configuration

Read `config/models.json` and `config/limits.json` from this package's root (the
parent of the `skills/` directory containing this skill).

- Resolve each role you will use to its model ID.
- Verify the IDs exist: run `pi --list-models` and match. If a role's model is
  missing from the catalog, warn once naming the role and the missing ID, and let
  that role fall back to the session model. Never abort over a missing model.
- **Then compare the resolved models, not the configured ones.** `config/models.json`
  is validated for `reviewer` ≠ `worker`, but that check runs on what is written,
  not on what a machine resolves. Where the config targets a provider this machine
  does not have, *every* role falls back to the session model and the two collapse
  onto it. Say so explicitly:

  ```
  worker and reviewer both resolved to <model> - review is not a second opinion.
  Fix the routing:  node scripts/suggest-models.mjs
  ```

  `/skill:build` treats this as a **STOP**; every other skill warns once and
  continues, because only build gates on the reviewer.
- If `scripts/apply-models.mjs` has been run, `subagents.agentOverrides` already
  pins these. Pass `model` explicitly on each delegation anyway — it costs nothing
  and survives a machine where bootstrap was never run.
- **Routing freshness**, once per session, not per skill invocation: run
  `node scripts/check-routing-fresh.mjs`. On `stale`, print its one-line update
  command. On `offline`, say nothing. Never block on this.

## 3. Locate artifacts

- Project root = the git top-level (`git rev-parse --show-toplevel`), else cwd.
- Ensure `<project-root>/.pi-workflow/` exists; create it if not.
- **Verify it is ignored**: `git check-ignore -q .pi-workflow`, and the same for
  `.pi-subagents` (pi-subagents writes full run transcripts there — hundreds of
  kilobytes of fetched page content per run). If either fails and this is a git
  repo, add it to `.gitignore` immediately and say so.
- **Then verify nothing is already tracked**:

  ```sh
  git ls-files --cached .pi-workflow .pi-subagents
  ```

  **A `.gitignore` entry does not untrack what is already in the index.** If that
  command prints anything, the ignore is cosmetic and those files are still staged
  for the next commit. Fix it and say so:

  ```sh
  git rm -r --cached .pi-workflow .pi-subagents
  ```

  Planning artifacts must never be committable, and "I added it to .gitignore" is
  not evidence that they are not.
- Read `state.json` if present. Its schema is in `shared/artifacts.md`.

## 4. Announce

One compact line, then get to work:

```
mla-pi/<skill> · <project-root> · plan ok · build in_progress
```

Report prior-stage status from `state.json`. If a prior stage this skill depends on
is missing, say so and recommend the command that produces it — but do not refuse
to run unless this skill's own instructions say to. The user may have good reason
to skip a stage.
