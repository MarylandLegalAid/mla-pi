---
name: yeet
description: Commit and ship, safely. Confirms once per repo whether to push straight to main or open a branch for review, then remembers that choice. Audits gitignore, scans the staged diff for secrets, shows exactly what will and will not be committed, writes a conventional commit message, and pushes. Refuses to continue if anything looks like a credential. Use when work is done and verified.
---

# yeet

Assumes the repo is or will become public, and that planning docs must never
leave the machine through git.

Read `shared/preflight.md` from this package root and follow it now. Then read
`shared/asking.md`.

---

## 1. Repo checks

In a git repo, with a remote configured? If not, stop and say what to add.

**Determine the target** from `git config --local mla.yeet-target`:

- **Unset** — ask once (`ask_user_question`): push straight to `main` (simple,
  right for a repo one person owns and runs), or open a branch for review
  (right once more than one person touches this repo, or the change is risky
  enough to want a second look). Write the answer to that key
  (`git config --local mla.yeet-target main|branch`) and proceed — later runs
  here follow it silently. Override for one run by saying so ("yeet to a
  branch this time"); say "change my yeet default" to re-ask and overwrite it.
- **`main`** — if not on `main`, ask: switch, merge in, or push this branch
  once instead. Behind the remote? `git pull --rebase` first, **stopping on
  conflict** — resolving someone else's conflict unattended isn't this skill's job.
- **`branch`** — use the current branch if already on one, else create one
  named for the change. No rebase-behind check: a fresh branch has no
  upstream to conflict with.

## 2. Audit .gitignore

Ensure it covers the following, adding what is missing and reporting each addition:

- **`.pi-workflow/`** — non-negotiable
- `.pi-subagents/`
- `.env`, `.env.*` with `!.env.example`
- `node_modules/`, `dist/`, `build/`, `.next/`, `out/`, `coverage/`,
  `__pycache__/`, `*.pyc`, `bin/`, `obj/`
- `.DS_Store`, editor directories
- stack-specific artifacts actually present in the tree: `.terraform/`,
  `*.tfstate*`, `.azure/`, `.aws-sam/`, `cdk.out/`, `playwright-report/`,
  `test-results/`

Then verify: `git check-ignore -q .pi-workflow`.

## 3. Already-tracked violations

If anything matching those patterns is **already tracked** — a previously
committed `.env`, a stray `dist/` — **STOP**. Report it and explain plainly:

> `git rm --cached` stops tracking it going forward but does **not** remove it from
> history. If this file ever contained a live credential, rotate the credential —
> removing the file is not enough.

Do not rewrite history unless the user explicitly asks for it.

## 4. Stage

`git add -A`, then review `git diff --cached --stat`.

## 5. Secret scan

Both passes run. Both are required.

**a. gitleaks**, if available:

```sh
gitleaks protect --staged --redact
```

If it is absent, offer to install it (`catalog/tools.yaml`) but do not require it —
pass (b) always runs.

**b. Built-in regex pass** over the staged diff, regardless of (a):

Read `shared/secret-patterns.md` from this package root and run **every** pattern
in its ```patterns block against the staged diff, plus every pattern in its
```filenames block against the staged paths. That file is the single source —
`scripts/validate.mjs` compiles the same list, so the two cannot drift. Do not
work from a list you remember.

**Any hit is fatal.** Report file and line with the value **redacted**, unstage
everything (`git reset`), and STOP.

**There is no override flag.** Do not offer one. Do not commit "just the safe
files". The user fixes it and re-runs.

## 6. Show the manifest

Before committing, print both lists. The second is the one the user actually
checks:

```
COMMITTING  12 files  +814 -62
  src/api/auth.ts   +180

EXCLUDED (gitignored)
  .pi-workflow/     planning artifacts - hand-carried, never committed
  .env.local        secrets
```

## 7. Commit message

Conventional commit (`type(scope): subject`), imperative mood, derived from the
**actual diff** plus package names from `state.json` when present. Body: what
changed and why, one bullet per area. No emoji, no AI co-author trailer unless
asked, no description of work that is not in the diff.

Show the message and allow an edit via `ask_user_question` before committing.

## 8. Commit and push

Commit. Then, per the target from §1:
- **`main`**: `git push origin main`.
- **`branch`**: `git push -u origin <branch>`. If `gh` is authenticated, offer
  to open a pull request; if not, print the compare URL.

Report the SHA and where it went. If the push is rejected, **report the real
error**. Do not retry with `--force`.

## 9. Close

Update `state.json`: `stages.yeet.status = "complete"`, record the SHA.

---

## Hard rules

- Never force-push. Never rewrite history unprompted.
- Never commit `.pi-workflow/`. If it ever appears staged, that is a bug — stop
  and report rather than working around it.
- Never bypass the secret scan, for any reason, on any request.
- Never write a commit message that overstates what changed.
- Never commit work you were not asked to commit — if the tree contains
  unrelated changes, surface them and ask.
- Never silently switch a repo's remembered `mla.yeet-target` — only on an
  explicit "change my yeet default" request.
