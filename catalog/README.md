# Tool catalog

`tools.yaml` is the curated inventory `/skill:plan` probes before a task.
It exists so plan does not re-research `az` and `docker` on every project.
Anything not in the catalog is still handled — plan delegates to the
`mla-researcher` agent for niche or unfamiliar tooling — but catalog hits are
fast, deterministic, and reflect decisions you have already made.

## Entry schema

```yaml
- id: <stable-slug>          # required, unique
  name: <human name>         # required
  kind: cli | mcp | runtime | service
  detect: <shell command>    # required; exit 0 means present. Cheap, non-interactive.
  install: <shell command>   # required; the default. MANUAL if nothing is scriptable
  install_family: <family>   # optional; declares which family `install` targets
  install_debian: <command>  # optional per-family override; MANUAL is allowed
  install_fedora: <command>
  install_arch: <command>
  install_notes: <string>    # optional; PATH additions, post-install steps, caveats
  sudo: true | false         # required; true => plan prints it, never runs it
  scope: global | project    # required
  auth: <command>            # optional; the interactive login. Never run by an agent.
  auth_check: <command>      # optional; cheap non-interactive credential check
  domains: [<slug>, ...]     # required; matched against the task's domain
```

## Platforms

Supported families are `debian`, `fedora` and `arch`. plan detects the
machine's family, then resolves a command: `install_<family>` first, the bare
`install` only if the package manager it invokes is actually present, and failing
both it researches the command for that platform rather than guessing.

`validate.mjs` infers the family of `install` from the package manager it names
(`apt`/`snap` → debian, `dnf`/`yum`/`rpm` → fedora, `pacman` → arch) and **fails
if any other supported family lacks a command**. Where `install` is distro-bound
without naming a manager — `aka.ms/InstallAzureCLIDeb` is the example — say so
with `install_family`, or the check cannot see it.

An entry whose `install` is genuinely portable (a `curl … | sh` installer, `npm
i`, `dotnet tool install`, `uv tool install`) needs no per-family keys at all.
Add one only where the portable path breaks: `docker` carries an `install_arch`
because `get.docker.com` refuses on Arch.

Use `MANUAL` for a family with no scriptable path — Arch's AUR-only packages are
the common case — and explain the real route in `install_notes`. A `MANUAL` you
can justify is worth more than a command you have not run.

## Rules

- **`detect` must be cheap and non-interactive.** No prompts, no browser, no
  network round-trip that can hang. Prefer `--version`. Where a CLI can exist
  without working (Docker), detect the working state (`docker info`).
- **If any install variant contains `sudo`, `sudo: true`.** This is enforced by
  `scripts/validate.mjs` across `install` and every `install_<family>`. plan
  never executes a sudo command; it prints it for you to run in another terminal
  and then re-probes.
- **`auth` is never run by an agent.** Logins are interactive by nature. They are
  surfaced as outstanding manual steps in the plan overview's Tooling section.
- **`scope: global`** for anything reusable across projects — common dev tooling
  and your standing hosting/infra stack. **`scope: project`** for niche or
  project-specific tooling. plan asks when the catalog does not classify.
- Use `install: MANUAL` rather than guessing a command. A wrong install command is
  worse than no entry: plan will run a non-sudo one.

## Adding a tool

Add the entry, then verify honestly:

```sh
# detect must exit non-zero when absent and zero when present
sh -c '<detect>' ; echo "exit=$?"
node scripts/validate.mjs
```

Pick `domains` values that match how you would describe a task ("azure",
"power-apps", "e2e"), not how the vendor markets the tool. `any` means the tool is
a candidate for every task.

Per-family commands come from the vendor's own install page for that distro, not
from translating the Debian one. Note in `install_notes` where a command is
version-sensitive — the `gh` Fedora command is dnf5 syntax and differs on dnf4.
