#!/usr/bin/env bash
# mla-pi bootstrap: installs the companion pi packages the skills depend on and
# applies OpenRouter model routing. Safe to re-run. Called by install.sh during
# the one-command install, and by /skill:setup any time something needs fixing.
#
# pi does not install pi packages transitively, so `pi install git:...` gets the
# skills but not the packages they call. This closes that gap.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

REQUIRED=(
  "npm:pi-subagents"
  "npm:@juicesharp/rpiv-ask-user-question"
  "npm:pi-web-access"
)

info() { printf '  %s\n' "$*"; }
# Not named `head`: that would shadow the `head` binary. install.sh learned this
# the hard way - a `| head -1` inside a version string printed a section banner.
section() { printf '\n%s\n' "$*"; }

section "mla-pi bootstrap"
info "package root: $ROOT"

# ------------------------------------------------------------------ check pi
if ! command -v pi >/dev/null 2>&1; then
  echo "error: pi is not on PATH. Install it first: https://pi.dev" >&2
  exit 1
fi

PI_VERSION="$(pi --version 2>/dev/null || echo unknown)"
info "pi version:   $PI_VERSION"

case "$PI_VERSION" in
  0.[0-7][0-9].*|0.[0-9].*)
    info "warning: mla-pi is developed against pi 0.81+; some features may be missing"
    ;;
esac

# ------------------------------------------------------- install companions
section "companion packages"

INSTALLED="$(pi list 2>/dev/null || true)"
CHANGED=0

for pkg in "${REQUIRED[@]}"; do
  name="${pkg#npm:}"
  if printf '%s' "$INSTALLED" | grep -qF -- "$name"; then
    info "already present   $name"
  else
    info "installing        $name"
    if pi install "$pkg"; then
      CHANGED=1
    else
      echo "error: failed to install $pkg" >&2
      exit 1
    fi
  fi
done

# ------------------------------------------------------------ model routing
# apply-models exits non-zero when nothing resolved. That is not a reason to abort
# - the packages are already installed and useful - but it must not read as success.
section "OpenRouter model routing"
ROUTING_OK=1
if ! node "$ROOT/scripts/apply-models.mjs"; then
  ROUTING_OK=0
  info ""
  info "Model routing did not take - most likely no OpenRouter key is configured yet"
  info "(export OPENROUTER_API_KEY=... or pi login openrouter). The packages are"
  info "installed and the skills will load, but every agent will inherit whatever"
  info "session model is already set until this is fixed."
fi

# ------------------------------------------------------------ search curator
section "search curator"
node "$ROOT/scripts/apply-web-search.mjs"

# --------------------------------------------------------------------- doctor
# The last word on whether this machine is actually set up, rather than on
# whether this script reached its end.
section "checks"
node "$ROOT/scripts/doctor.mjs" || true

# ------------------------------------------------------------------- summary
section "done"
if [ "$CHANGED" -eq 1 ]; then
  info "Restart pi so the newly installed packages register."
else
  info "No packages changed."
fi
if [ "$ROUTING_OK" -eq 0 ]; then
  info ""
  info "Fix model routing first:"
  info "  export OPENROUTER_API_KEY=...            # or: pi login openrouter"
  info "  node $ROOT/scripts/apply-models.mjs"
  info "If that still fails, propose a fallback mapping:"
  info "  node $ROOT/scripts/suggest-models.mjs --write"
fi
info ""
info "Then check the skills are visible:"
info "  /skill:plan   /skill:build   /skill:yeet"
info ""
info "Re-run the checks any time:"
info "  node $ROOT/scripts/doctor.mjs"
