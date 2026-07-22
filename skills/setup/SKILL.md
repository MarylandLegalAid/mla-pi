---
name: setup
description: Finish installing mla-pi on this machine. Installs the companion packages the other skills call, applies OpenRouter model routing, defaults web search to raw results, and reports what is still wrong. Use once after installing the package, or any time a skill reports a missing capability.
---

# setup

The only skill that runs before the companion packages exist, so it **does not
read `shared/preflight.md`** — preflight stops on the very tools this installs.

Everything here is also available as `bash scripts/bootstrap.sh`, which is what
`install.sh` calls during the one-command install. This skill exists for later:
any time a skill reports something missing, or the OpenRouter key changes.

## 1. Locate the package root

The directory containing this skill's `skills/` parent. Resolve it once and use it
for every path below — never guess at `~/.pi/agent/...`, which differs between git
and npm installs.

Confirm `scripts/bootstrap.sh` exists there. If it does not, stop and say the
package looks incomplete.

## 2. Run the bootstrap

```sh
bash <package-root>/scripts/bootstrap.sh
```

Show its output. It installs the three companion packages, applies OpenRouter
model routing (agent overrides plus the session default model), defaults the
search curator off, and ends by running the doctor.

Do not reimplement any of that here. If bootstrap fails, report its actual error
and stop — a partially installed machine is worse than an obviously broken one.

## 3. Read the doctor's verdict

Bootstrap ends with `node <package-root>/scripts/doctor.mjs`. Interpret it:

- **0 failures** → say so, and go to §5.
- **`OpenRouter auth` failed** → no key configured. Point to the org's key
  distribution process (`docs/admin.md`), then `pi login openrouter` or
  `export OPENROUTER_API_KEY=...` and re-run bootstrap.
- **`role models` failed** → the shipped routing targets a provider this machine
  does not have (should not happen once OpenRouter is authenticated — if it
  does, something else is wrong). Offer to fix it:

  ```sh
  node <package-root>/scripts/suggest-models.mjs           # proposal only
  node <package-root>/scripts/suggest-models.mjs --write   # apply
  node <package-root>/scripts/apply-models.mjs             # route the agents
  ```

  Show the proposal **before** writing, and say plainly it only guarantees
  worker and reviewer differ, and stays within open-weight models — the
  role-to-model fit is still worth reviewing.

- **`reviewer is a second opinion` failed** → say what it means in one line:
  build's review gate would be the worker reviewing itself. `/skill:build`
  stops on it, so it must be fixed rather than noted.
- **`gh auth` or `git identity` failed** → print the exact command
  (`gh auth login`, `git config --global user.name/user.email`) and wait for it.
  `/skill:yeet` cannot push without both.
- **`routing freshness` warns stale** → this machine's routing differs from the
  package's `main` branch. Run the update command it prints.
- **a package is missing** → re-run bootstrap once. If it fails again, print the
  `pi install` command and hand it over.

## 4. Re-check

Run the doctor again after any fix. Never report success from having run a fix —
report it from a clean doctor run.

## 5. Close

Tell the user to restart pi if anything was installed, then:

```
Next: /skill:plan <your goal>
```

## Hard rules

- **Never execute a command containing `sudo`.** Nothing here needs it. If
  something appears to, stop and print it instead.
- Never edit `config/models.json` by hand — use `suggest-models.mjs --write`, so
  the reviewer/worker rule and the open-weight policy are both enforced and a
  backup exists.
- Never claim a check passed without a doctor run showing it.
- Never continue past a failing `reviewer is a second opinion` check by saying it
  can be fixed later. It cannot: build stops on it.
