// Shared ANSI helpers: stripping/width (used by both the box layout in
// scripts/session-splash.mjs and the standalone scripts/splash-cli.mjs) and
// the cursor-control escapes the standalone CLI's terminal driver needs.
// Zero dependencies.

export const ANSI_RE = /\x1b\[[0-9;]*m/g;

export function stripAnsi(str) {
  return str.replace(ANSI_RE, "");
}

/** Rendered width, ignoring ANSI color codes (which are zero-width on screen). */
export function visibleWidth(str) {
  return stripAnsi(str).length;
}

export const HIDE_CURSOR = "\x1b[?25l";
export const SHOW_CURSOR = "\x1b[?25h";
export const CLEAR_LINE = "\x1b[2K";

/** Move the cursor up `n` rows (no-op string for n<=0). */
export const moveUp = (n) => (n > 0 ? `\x1b[${n}A` : "");
