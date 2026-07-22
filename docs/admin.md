# Admin runbook

This is for whoever holds the OpenRouter account and the GitHub org for Maryland
Legal Aid — currently John. Staff should not need any of this; point them at
the README instead.

## One-time setup

### 1. Create the GitHub org and repo

1. Create a GitHub organization for MLA if one doesn't exist yet, and a public
   repo named `mla-pi` inside it.
2. Push this codebase to it.
3. **Find-replace `<MLA-ORG>`** with the real org name, everywhere it appears:

   ```sh
   grep -rl '<MLA-ORG>' . --exclude-dir=.git | xargs sed -i 's/<MLA-ORG>/your-real-org-name/g'
   ```

   This touches `package.json`, `README.md`, `install.sh`,
   `scripts/check-routing-fresh.mjs`, `docs/`, and `intune/deploy-wsl.ps1`.
   Commit that as its own change so it's easy to review.
4. Confirm the raw-content URL resolves once pushed:
   `https://raw.githubusercontent.com/<org>/mla-pi/main/config/models.json`
   should return the file, not a 404.

Public is deliberate: nothing sensitive lives in this repo (keys are pasted at
install time and stored only on each staff member's own machine), and a public
repo means the one-line install needs no GitHub authentication at all.

### 2. Get an OpenRouter account

Sign up for OpenRouter and add a payment method. Everything below assumes you
can create individually-limited API keys from its dashboard.

## Bringing on a new person

### 3. Issue their OpenRouter key

From the OpenRouter dashboard, create a new API key:

- Label it with their name, so usage is attributable later.
- Set a **spend limit**. Start conservative — $10–20/month is a reasonable
  opening figure for someone new to the tool — and raise it once you see their
  actual usage pattern. Raising a limit is a two-click fix; a runaway key with
  no limit is not.

Send them the key through whatever channel you'd send any other credential
(password manager share, not chat). They paste it once, during install — it is
never stored anywhere but their own machine's `~/.pi/agent/auth.json`.

### 4. Get WSL onto their Windows machine (skip if they're on Linux)

Deploy `intune/deploy-wsl.ps1` via Intune: **Devices → Scripts and
remediations → Platform scripts**, Windows 10/11, run as SYSTEM, 64-bit
PowerShell host. Assign it to the device (or a group). Because enabling the
WSL features sometimes needs a reboot before it can finish, set the script's
schedule to retry (daily, or "rerun until successful") rather than "run once"
— it tracks its own progress and picks up where it left off.

Once it reports success (check the run status in Intune, or exit code 0 in the
script output), tell the person:

1. Open **Ubuntu** from the Start menu. It'll ask them to set a Linux username
   and password the first time — anything works, it doesn't need to match
   their Windows login.
2. Paste the install command from the README into that window.

Linux staff, or anyone on a spare Linux-imaged laptop, skip straight to the
install command — no Intune step needed.

### 5. They run the one-line install

That's the README's job from here — `curl ... | bash`, paste their OpenRouter
key when it asks, done. Nothing else for you to do unless something breaks; if
it does, `/skill:setup` inside pi re-runs the fixable parts and reports what's
still wrong.

## Ongoing

### Changing model routing org-wide

`config/models.json` is the single source of truth. To change what model a
role uses (price change, new release worth switching to, budget squeeze):

1. Edit `config/models.json` on `main`. Open-weight is the default — see the
   `$policy` note in that file — but a closed/proprietary model is fine if it
   earns its premium; `scripts/validate.mjs` only warns on non-open-weight,
   it won't block the commit. `roles.reviewer` must resolve to a different
   model (ideally a different lab) than `roles.worker`, or `validate.mjs`
   *will* fail your commit — that check is a hard rule, not a warning. Use
   each role's full list price in `pricePerMillion`, not a promotional rate.
2. Commit and push.

Staff don't need to do anything immediately — `scripts/check-routing-fresh.mjs`
runs once per skill session and prints a one-line nudge (with the exact update
command) the next time anyone's local routing differs from `main`. There is no
push mechanism and no silent remote change mid-session: someone mid-task keeps
their current models until they choose to update.

To sanity-check a change before committing, run `node scripts/suggest-models.mjs`
against your own authenticated OpenRouter account — it won't touch the file,
just shows what it would propose from the live catalog.

### Someone leaves

1. Delete their OpenRouter key from the dashboard (or set its spend limit to
   zero) — this is the only credential that matters, since the repo itself is
   public and holds no secrets.
2. Remove them from the GitHub org if they were a member (only relevant if
   they also had access to private project repos — installing `mla-pi` itself
   never required org membership).

### Something is broken and you're not sure why

`node scripts/doctor.mjs` from the package root is the single source of truth
for "what's wrong on this machine" — every check prints the exact fix command.
`/skill:setup` inside pi does the same thing conversationally and can re-run
the fixable steps for you.
