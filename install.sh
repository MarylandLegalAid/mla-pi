#!/usr/bin/env bash
# mla-pi turnkey installer.
#
#   curl -fsSL https://raw.githubusercontent.com/MarylandLegalAid/mla-pi/main/install.sh | bash
#
# Takes a bare WSL (Ubuntu) or Linux (debian/fedora/arch family) shell to a
# working pi session with the mla-pi skills loaded. Idempotent: safe to re-run,
# and every step reports "already done" distinctly from "done".
#
# Human input needed: your sudo password (package installs), your OpenRouter
# API key (paste once), your name/email if git has never been configured, and
# the GitHub device-flow login in your browser.

set -euo pipefail

info() { printf '  %s\n' "$*"; }
# Not named `head`: that would shadow the `head` binary this script pipes into.
section() { printf '\n== %s ==\n' "$*"; }
warn() { printf '  warning: %s\n' "$*" >&2; }
die() {
  printf '\nerror: %s\n' "$*" >&2
  exit 1
}

REPO_SLUG="MarylandLegalAid/mla-pi"

# --------------------------------------------------------------- interactivity
# curl | bash has no usable stdin - every prompt reads from the controlling
# terminal directly, or this script has no business prompting at all.
if [ ! -e /dev/tty ]; then
  die "no interactive terminal available (running with stdin fully redirected?). Run this script directly instead of through another pipe."
fi

ask() {
  local __resultvar="$1" prompt="$2" answer
  read -r -p "$prompt" answer </dev/tty
  printf -v "$__resultvar" '%s' "$answer"
}

ask_silent() {
  local __resultvar="$1" prompt="$2" answer
  read -r -s -p "$prompt" answer </dev/tty
  echo
  printf -v "$__resultvar" '%s' "$answer"
}

# ----------------------------------------------------------------- 1. platform
section "platform"

# Overridable so tests can point these at a fixture instead of the real
# machine; real runs always use the actual files.
PROC_VERSION_PATH="${MLA_PI_PROC_VERSION:-/proc/version}"
OS_RELEASE_PATH="${MLA_PI_OS_RELEASE:-/etc/os-release}"

if grep -qi microsoft "$PROC_VERSION_PATH" 2>/dev/null; then
  info "WSL detected - proceeding exactly as on native Linux from here."
fi

# shellcheck source=/dev/null
. "$OS_RELEASE_PATH" 2>/dev/null || die "cannot read $OS_RELEASE_PATH - unsupported system"
OS_ID="${ID:-unknown}"
OS_ID_LIKE="${ID_LIKE:-}"

FAMILY=""
case " $OS_ID $OS_ID_LIKE " in
  *" debian "*|*" ubuntu "*|*" linuxmint "*|*" pop "*) FAMILY=debian ;;
esac
if [ -z "$FAMILY" ]; then
  case " $OS_ID $OS_ID_LIKE " in
    *" fedora "*|*" rhel "*|*" centos "*|*" rocky "*|*" almalinux "*) FAMILY=fedora ;;
  esac
fi
if [ -z "$FAMILY" ]; then
  case " $OS_ID $OS_ID_LIKE " in
    *" arch "*|*" manjaro "*|*" endeavouros "*) FAMILY=arch ;;
  esac
fi

case "$FAMILY" in
  debian) command -v apt-get >/dev/null 2>&1 || FAMILY="" ;;
  fedora) command -v dnf >/dev/null 2>&1 || FAMILY="" ;;
  arch)   command -v pacman >/dev/null 2>&1 || FAMILY="" ;;
esac

# --- npm per-user prefix and PATH persistence -------------------------------
# A distro-packaged Node leaves npm's global prefix at /usr/local, which is
# root-owned: `npm install -g` dies with EACCES. Installing under sudo instead
# would leave root-owned files in $HOME's npm cache and break later self-updates,
# so point npm at a per-user prefix - the same shape nvm-installed Node already
# has - and put its bin dir on PATH. Defined up here, above the test hook below,
# so the suite can exercise persist_npm_path without running the real installer.
NPM_USER_PREFIX="$HOME/.npm-global"

# Add one PATH line to a profile file, unless $needle already appears in it.
# Creates the profile's parent directory (fish keeps its config a few levels down).
_persist_path_line() {
  local profile="$1" line="$2" needle="$3"
  if [ -f "$profile" ] && grep -qF "$needle" "$profile"; then
    info "already on PATH   $needle (via $profile)"
    return
  fi
  mkdir -p "$(dirname "$profile")"
  printf '\n# added by mla-pi install.sh: npm global installs without sudo\n%s\n' "$line" >>"$profile"
  info "added to PATH     $needle (in $profile - open a new shell to pick it up)"
}

# Put $NPM_USER_PREFIX/bin on PATH for every shell the user actually has, not just
# the one named by $SHELL. $SHELL is the login shell from /etc/passwd - commonly
# bash even for someone who runs fish or zsh interactively - so keying off it alone
# stranded `pi` off-PATH for exactly those users. A shell counts as present if its
# binary is installed or it already has a config file; if none match, fall back to
# ~/.profile so at least a POSIX login shell picks it up.
persist_npm_path() {
  local bindir="$NPM_USER_PREFIX/bin" posix_line wrote_any=0
  posix_line="export PATH=\"$bindir:\$PATH\""

  if command -v bash >/dev/null 2>&1 || [ -f "$HOME/.bashrc" ]; then
    _persist_path_line "$HOME/.bashrc" "$posix_line" "$bindir"; wrote_any=1
  fi
  if command -v zsh >/dev/null 2>&1 || [ -f "$HOME/.zshrc" ]; then
    _persist_path_line "$HOME/.zshrc" "$posix_line" "$bindir"; wrote_any=1
  fi
  if command -v fish >/dev/null 2>&1 || [ -f "$HOME/.config/fish/config.fish" ]; then
    _persist_path_line "$HOME/.config/fish/config.fish" "fish_add_path $bindir" "$bindir"; wrote_any=1
  fi

  [ "$wrote_any" -eq 1 ] || _persist_path_line "$HOME/.profile" "$posix_line" "$bindir"
}

# Test hook: sourcing this file with MLA_PI_TEST_SOURCE=1 stops here, after
# platform detection but before anything installs or prompts, so a test can
# inspect $FAMILY/$OS_ID/$IS_WSL under a fake /etc/os-release and PATH, and can
# call the PATH-persistence helpers defined just above.
if [ "${MLA_PI_TEST_SOURCE:-}" = "1" ]; then
  # shellcheck disable=SC2317  # reachable when sourced; exit is the direct-run fallback
  return 0 2>/dev/null || exit 0
fi

[ -n "$FAMILY" ] || die "unrecognized platform ($OS_ID / $OS_ID_LIKE) or its expected package manager is missing. mla-pi supports debian, fedora and arch families (native or WSL). Install prerequisites by hand: git, curl, Node >= 20, then re-run this script."

info "family: $FAMILY  (${OS_ID} ${VERSION_ID:-})"

SUDO_WARNED=0
first_sudo_notice() {
  if [ "$SUDO_WARNED" -eq 0 ]; then
    info "This installer needs sudo for system packages (git, curl, Node, GitHub CLI)."
    info "You may be prompted for your password."
    SUDO_WARNED=1
  fi
}

pkg_install() {
  # pkg_install <debian-pkg...> -- <fedora-pkg...> -- <arch-pkg...>
  first_sudo_notice
  case "$FAMILY" in
    debian) sudo apt-get update -qq && sudo apt-get install -y "$@" ;;
    fedora) sudo dnf install -y "$@" ;;
    arch)   sudo pacman -Sy --noconfirm "$@" ;;
  esac
}

# --------------------------------------------------------- 2. git, curl, node
section "git, curl"

if command -v git >/dev/null 2>&1 && command -v curl >/dev/null 2>&1; then
  info "already present   git $(git --version | grep -oE '[0-9.]+' | head -1), curl"
else
  info "installing        git, curl"
  pkg_install git curl
fi

section "node.js (>= 20)"

node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  local major
  major="$(node -e 'console.log(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)"
  [ "$major" -ge 20 ]
}

if node_ok; then
  info "already present   node $(node --version)"
else
  # nvm rather than a distro package: one install path across debian, fedora,
  # arch and WSL alike, no sudo, no per-distro version drift to track. Verified
  # against the nvm install actually in use on the reference machine this
  # installer was built against (nvm 0.40.x, installing Node 24 LTS).
  info "installing        Node via nvm (no sudo needed)"
  export NVM_DIR="$HOME/.nvm"
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
  fi
  # shellcheck source=/dev/null
  . "$NVM_DIR/nvm.sh"
  nvm install --lts
  nvm alias default lts/*
  node_ok || die "Node install via nvm did not produce a working node >= 20. Check $NVM_DIR/nvm.sh sourced correctly and re-run."
  info "installed         node $(node --version)"
  info "note: open a new shell (or 'source ~/.nvm/nvm.sh') for future sessions to see this node."
fi

# ------------------------------------------------------------------- 3. pi
section "pi coding agent"

# NPM_USER_PREFIX and persist_npm_path are defined near the top of this script
# (with the rationale); npm_prefix_writable stays here, next to the one caller
# that consults it.
npm_prefix_writable() {
  local prefix="$1"
  [ -n "$prefix" ] || return 1
  # The two directories npm actually writes into for a global install. A missing
  # one is fine as long as npm can create it, i.e. its parent is writable.
  local dir
  for dir in "$prefix/lib/node_modules" "$prefix/bin"; do
    while [ ! -e "$dir" ] && [ "$dir" != "/" ]; do dir="$(dirname "$dir")"; done
    [ -w "$dir" ] || return 1
  done
}

if command -v pi >/dev/null 2>&1; then
  info "already present   pi $(pi --version 2>/dev/null || echo unknown)"
else
  NPM_PREFIX="$(npm config get prefix 2>/dev/null || true)"
  if ! npm_prefix_writable "$NPM_PREFIX"; then
    info "npm's global prefix ($NPM_PREFIX) is not writable by you."
    info "switching npm to $NPM_USER_PREFIX so global installs need no sudo."
    mkdir -p "$NPM_USER_PREFIX/lib" "$NPM_USER_PREFIX/bin"
    npm config set prefix "$NPM_USER_PREFIX" || die "could not set npm prefix to $NPM_USER_PREFIX. Set it by hand ('npm config set prefix ~/.npm-global'), add ~/.npm-global/bin to PATH, and re-run this script."
    export PATH="$NPM_USER_PREFIX/bin:$PATH"
    persist_npm_path
  fi

  info "installing        pi (npm install -g @earendil-works/pi-coding-agent)"
  npm install -g @earendil-works/pi-coding-agent || die "pi install failed. If the error mentions npm's cache (ENOENT under _cacache), run 'npm cache clean --force' and re-run this script. Otherwise check https://pi.dev for the current install method."
  hash -r 2>/dev/null || true
  command -v pi >/dev/null 2>&1 || die "pi installed but is not on PATH. Add \"\$(npm config get prefix)/bin\" to your PATH and re-run this script."
  info "installed         pi $(pi --version)"
fi

# ------------------------------------------------------------------- 4. gh CLI
section "GitHub CLI"

if command -v gh >/dev/null 2>&1; then
  info "already present   gh $(gh --version | head -1 | grep -oE '[0-9.]+' | head -1)"
else
  info "installing        gh"
  first_sudo_notice
  case "$FAMILY" in
    debian)
      curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
        | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
      echo "deb [signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
        | sudo tee /etc/apt/sources.list.d/github-cli.list >/dev/null
      sudo apt-get update -qq
      sudo apt-get install -y gh
      ;;
    fedora)
      sudo dnf install -y gh
      ;;
    arch)
      sudo pacman -S --noconfirm github-cli
      ;;
  esac
  command -v gh >/dev/null 2>&1 || die "gh install did not succeed. See https://github.com/cli/cli/blob/trunk/docs/install_linux.md"
  info "installed         gh $(gh --version | head -1)"
fi

# ------------------------------------------------------------ 5. OpenRouter key
section "OpenRouter API key"

AGENT_DIR="${PI_CODING_AGENT_DIR:-${XDG_CONFIG_HOME:+$XDG_CONFIG_HOME/pi}}"
AGENT_DIR="${AGENT_DIR:-$HOME/.pi}"
AUTH_JSON="$AGENT_DIR/agent/auth.json"

has_openrouter_key() {
  [ -n "${OPENROUTER_API_KEY:-}" ] && return 0
  [ -f "$AUTH_JSON" ] || return 1
  AUTH_JSON_PATH="$AUTH_JSON" node -e '
    const fs = require("fs");
    try {
      const auth = JSON.parse(fs.readFileSync(process.env.AUTH_JSON_PATH, "utf8"));
      process.exit(auth.openrouter && auth.openrouter.key ? 0 : 1);
    } catch { process.exit(1); }
  '
}

if has_openrouter_key; then
  info "already configured   OpenRouter key present"
else
  info "Your admin gave you a personal OpenRouter API key with its own spend limit."
  info "Paste it now - it is stored only on this machine, in $AUTH_JSON."
  ROUTER_KEY=""
  for _ in 1 2 3; do
    ask_silent ROUTER_KEY "OpenRouter API key: "
    [ -n "$ROUTER_KEY" ] || { warn "empty key, try again"; continue; }
    STATUS="$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $ROUTER_KEY" https://openrouter.ai/api/v1/key || echo 000)"
    if [ "$STATUS" = "200" ]; then
      break
    fi
    warn "that key was rejected (HTTP $STATUS) - check it and try again"
    ROUTER_KEY=""
  done
  [ -n "$ROUTER_KEY" ] || die "no valid OpenRouter key provided after 3 attempts. Re-run this script once you have one."

  OPENROUTER_KEY="$ROUTER_KEY" AUTH_JSON_PATH="$AUTH_JSON" node -e '
    const fs = require("fs");
    const path = require("path");
    const authPath = process.env.AUTH_JSON_PATH;
    let auth = {};
    if (fs.existsSync(authPath)) {
      try { auth = JSON.parse(fs.readFileSync(authPath, "utf8")); } catch {}
    }
    auth.openrouter = { type: "api_key", key: process.env.OPENROUTER_KEY };
    fs.mkdirSync(path.dirname(authPath), { recursive: true });
    fs.writeFileSync(authPath, JSON.stringify(auth, null, 2) + "\n", { mode: 0o600 });
    fs.chmodSync(authPath, 0o600);
  '
  unset ROUTER_KEY
  info "saved             OpenRouter key validated and stored"
fi

# --------------------------------------------------------- 6. git + gh identity
section "git identity"

GIT_NAME="$(git config --global user.name || true)"
GIT_EMAIL="$(git config --global user.email || true)"
if [ -n "$GIT_NAME" ] && [ -n "$GIT_EMAIL" ]; then
  info "already set       $GIT_NAME <$GIT_EMAIL>"
else
  info "git needs a name and email for commits (used by /skill:yeet)."
  [ -n "$GIT_NAME" ] || ask GIT_NAME "Your name: "
  [ -n "$GIT_EMAIL" ] || ask GIT_EMAIL "Your email: "
  git config --global user.name "$GIT_NAME"
  git config --global user.email "$GIT_EMAIL"
  info "set               $GIT_NAME <$GIT_EMAIL>"
fi

section "GitHub authentication"

if gh auth status >/dev/null 2>&1; then
  info "already authenticated"
else
  info "opening GitHub device-flow login - follow the prompts"
  gh auth login || die "gh auth login did not complete. Re-run this script when you're ready."
fi

# --------------------------------------------------------------- 7. the package
section "mla-pi package"

if pi list 2>/dev/null | grep -qF "$REPO_SLUG"; then
  info "already installed"
else
  info "installing"
  pi install "git:github.com/${REPO_SLUG}" || die "pi install failed for git:github.com/${REPO_SLUG}"
fi

# Same resolution technique as the README's manual one-liner: `pi list` prints
# the package name on one line and its resolved path on the next.
PKG_ROOT="$(pi list 2>/dev/null | grep -A1 "mla-pi" | tail -1 | xargs || true)"
if [ -z "$PKG_ROOT" ] || [ ! -d "$PKG_ROOT" ]; then
  die "installed mla-pi but could not resolve its path from 'pi list'. Run 'pi list' yourself and then: bash <path>/scripts/bootstrap.sh"
fi

info "resolved root     $PKG_ROOT"

bash "$PKG_ROOT/scripts/bootstrap.sh"

# ------------------------------------------------------------------- 8. report
section "done"

node "$PKG_ROOT/scripts/doctor.mjs" || true

echo ""
echo "Ready. Open a project folder, run 'pi', and start with:"
echo ""
echo "    /skill:plan <describe what you want to build>"
echo ""
echo "If you installed Node just now, open a new terminal (or 'source ~/.nvm/nvm.sh')"
echo "first so it's on PATH. Anything broken later: run /skill:setup, or"
echo "'node $PKG_ROOT/scripts/doctor.mjs' directly."
