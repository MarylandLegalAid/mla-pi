# mla-pi

An AI coding assistant for Maryland Legal Aid staff, built on the
[pi coding agent](https://pi.dev). It plans a piece of work with you by asking
questions, builds it, and helps you ship it — running on OpenRouter using your
own personal API key, paid for by MLA.

## Install

On a Linux machine, or Windows via WSL ("Ubuntu" from the Start menu — ask your
admin if you don't have it yet), open a terminal and run:

```sh
curl -fsSL https://raw.githubusercontent.com/<MLA-ORG>/mla-pi/main/install.sh | bash
```

It sets up everything: the pi agent itself, this package, and the tools it
needs. Along the way it will ask you to:

- **paste your OpenRouter API key** — your admin gives you this; it's stored
  only on this machine
- **give your name and email**, if git has never asked before (used for commits)
- **log into GitHub** in your browser, if you haven't already

It's safe to re-run if anything gets interrupted — it picks up where it left off.

## Your first session

Open a terminal in the folder you want to work in (or an empty one, for
something new) and run:

```sh
pi
```

You'll see a startup header with your model, current folder, a quick health
check (OpenRouter key, companion packages), and the commands below — it's
there every time as a reminder, not just the first run.

**`/skill:plan <describe what you want>`** — tell it what you're trying to
build, in as much or as little detail as you have. It'll figure out what tools
the job needs, then ask you questions one at a time — multiple choice, with an
explanation for each option — until it has a complete, unambiguous plan. Answer
honestly; the plan is only as good as the decisions in it. When it's done,
clear the conversation (start a fresh one) and run:

**`/skill:build`** — it works through the plan, writing and testing code as it
goes. For most tasks it does this directly in front of you; for larger
independent pieces of work it may hand parts off to run in parallel, and it'll
tell you when it does. It stops to ask if it hits a real decision point, gets
stuck, or needs something only you can do (like an account or a password).
When it's done, it will have run the thing locally so you can see it work.

**`/skill:yeet`** — commits and ships what was built. The first time you run it
in a given project, it'll ask whether to push straight to `main` or open a
branch for review — answer once, and it remembers your answer for that project
from then on. It always checks for anything that looks like a secret before
committing, and refuses if it finds one.

## Keeping it up to date

```sh
pi update git:github.com/<MLA-ORG>/mla-pi
```

Occasionally the model routing changes (a price change, a better model becomes
available) — you'll see a one-line note about it when a skill starts, with the
exact command to run.

## Something's not working

Run `/skill:setup` inside pi. It re-checks everything the installer set up and
fixes what it safely can. If it says something needs your attention, follow
what it prints — it always tells you the exact command. Or from a terminal:

```sh
node "$(pi list | grep -A1 mla-pi | tail -1 | xargs)"/scripts/doctor.mjs
```

## Why these particular models?

Every task in `/skill:plan` and `/skill:build` runs on an open-weight model —
chosen by MLA to keep costs predictable for a non-profit budget, not because
they're the only option. `/model` inside pi lets you switch models for your
own session if you want; ask your admin if you have questions about the
defaults, or see `docs/admin.md` if you administer this yourself.

---

## For anyone changing this repo

Conventions for editing skills, agents, and scripts live in `AGENTS.md`.
Running the org (keys, model routing, Intune deployment) is `docs/admin.md`.
What's guarded and why is `docs/verification.md`.

```sh
npm test                    # scripts/ test suite, no dependencies
node scripts/validate.mjs   # frontmatter, routing, catalog, references, secrets
node scripts/doctor.mjs     # is *this* machine actually set up?
```

`validate.mjs` checks the repo; `doctor.mjs` checks the machine. Both matter: a
config that validates cleanly can still collapse `worker` and `reviewer` onto
one model on a machine whose provider it doesn't target.

## License

MIT
