// Pure layout/formatting for the pi startup splash (extensions/session-splash.js
// is the only file that talks to pi or the machine; everything here is plain
// data/color-mode strings in, ANSI text out - zero dependencies, unit-tested
// directly, no pi-tui import (that would break running under plain `node --test`).

// ------------------------------------------------------------------- ANSI helpers
import { visibleWidth } from "./splash/ansi.mjs";
export { visibleWidth };

// ------------------------------------------------------- pi4mla wordmark: FIGlet
// The wordmark's letterform mask now comes from a real, off-the-shelf FIGlet
// font (scripts/splash/fonts/Terrace.flf, picked from a 159-font contact
// sheet - see scripts/splash-fonts.mjs) parsed by scripts/splash/figlet-format.mjs,
// not hand-drawn. Color/dither/outline compositing lives in
// scripts/splash/render-core.mjs, which this module just calls with the
// declarative settings in scripts/splash/splash.config.json. Both are shared
// with scripts/splash-cli.mjs (the standalone animated preview command), so
// there is one implementation of the artwork, not two.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFlf, layoutWord } from "./splash/figlet-format.mjs";
import { renderFrame, frameCanvasSize } from "./splash/render-core.mjs";

const SPLASH_DIR = join(dirname(fileURLToPath(import.meta.url)), "splash");

let _splashConfig;
/** The parsed splash.config.json + its font, loaded and parsed once. */
export function loadSplashConfig() {
  if (_splashConfig) return _splashConfig;
  const config = JSON.parse(readFileSync(join(SPLASH_DIR, "splash.config.json"), "utf8"));
  const font = parseFlf(readFileSync(join(SPLASH_DIR, config.font.file), "utf8"));
  _splashConfig = { config, font };
  return _splashConfig;
}

function gridFor(word) {
  const { config, font } = loadSplashConfig();
  return layoutWord(font, word, { mode: config.font.layoutMode }).grid;
}

/** Wordmark canvas width/height in cells, before any padding. Pure geometry, no color. */
export function mascotCanvasSize(word) {
  return frameCanvasSize(gridFor(word));
}

/**
 * Render `word` through the configured FIGlet font as a colored wordmark: a
 * flat outline and a horizontal gradient fill with a halftone dither
 * texture. No forced background - non-ink cells are plain whitespace, so the
 * wordmark sits directly on whatever background the terminal actually has.
 * `scheme` picks "dark" (white-ish outline, for dark backgrounds) or "light"
 * (black-ish outline, for light backgrounds); defaults to the config's
 * `defaultScheme`. `padTo` right-pads every row with plain whitespace so the
 * left column fills a fixed width instead of hugging the glyphs. `colorMode`
 * accepts this project's existing "truecolor"/"256color" values (mapped onto
 * render-core's "truecolor"/"256"/"none"). `animation`/`phase` are the same
 * "static"/"pan"/"shimmer" knobs scripts/splash-cli.mjs animates with -
 * extensions/session-splash.js uses them to play a shimmer intro (looping
 * until the user's first input) inside pi's own render loop, sharing this
 * one implementation of the artwork.
 */
export function buildMascotLines(word, { colorMode = "truecolor", padTo, animation = "static", phase = 0, scheme } = {}) {
  const { config } = loadSplashConfig();
  const mode = colorMode === "256color" ? "256" : colorMode === "none" ? "none" : "truecolor";
  return renderFrame(gridFor(word), config, { animation, phase, scheme, colorMode: mode, unicode: true, padTo });
}

// -------------------------------------------------------------------------- tips
export const TIPS = [
  { cmd: "/skill:plan", desc: "describe what you want; it interviews you and writes a plan" },
  { cmd: "/skill:build", desc: "builds it, testing as it goes" },
  { cmd: "/skill:yeet", desc: "commits and ships it" },
  { cmd: "/skill:setup", desc: "something not working? re-checks and fixes what it can" },
];

// Exported so extensions/session-splash.js can target these exact strings when
// colorizing, instead of duplicating the literal text.
export const HEADING_TIPS = "Getting started";
export const HEADING_STATUS = "Status";

// ----------------------------------------------------------------------- helpers
/** Collapse a home-directory prefix to `~`. */
export function shortenPath(cwd, home) {
  if (!cwd) return "";
  if (home && (cwd === home || cwd.startsWith(`${home}/`))) {
    return `~${cwd.slice(home.length)}`;
  }
  return cwd;
}

/** "DeepSeek V4 Pro · high effort", or a fallback when no model is configured yet. */
export function formatModelLine({ name, thinkingLevel } = {}) {
  if (!name) return "no model configured yet - run /model to pick one";
  return thinkingLevel ? `${name} · ${thinkingLevel} effort` : name;
}

export function authStatusLine({ hasKey }) {
  return hasKey ? "OpenRouter auth: ok" : "OpenRouter auth: missing - see docs/admin.md";
}

export function packagesStatusLine({ missing = [] } = {}) {
  return missing.length === 0
    ? "companion packages: ok"
    : `companion packages: missing ${missing.join(", ")}`;
}

// ------------------------------------------------------------------- box drawing
// A few columns wider than the wordmark itself, so it never gets sliced.
const LEFT_WIDTH = Math.max(36, mascotCanvasSize("pi4MLA").width);
const MIN_RIGHT_WIDTH = 26; // enough for "Getting started" plus reasonably short tip wraps
const BOX_OVERHEAD = 7; // "│ " + " │ " + " │" around the two columns
// Below this, the boxed two-column layout would squeeze the right column
// into near-uselessness - fall back to a plain single column instead.
export const NARROW_WIDTH = LEFT_WIDTH + MIN_RIGHT_WIDTH + BOX_OVERHEAD;
export const MAX_BOX_WIDTH = NARROW_WIDTH + 20;

const pad = (s, w) => {
  const vw = visibleWidth(s);
  if (vw >= w) return vw === s.length ? s.slice(0, w) : s; // never slice mid-ANSI-escape
  return s + " ".repeat(w - vw);
};

function wrapToWidth(text, width) {
  if (text.length <= width) return [text];
  const words = text.split(" ");
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > width) {
      if (line) lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Lay out the two-column boxed splash as text lines (the wordmark carries its
 * own ANSI color; everything else is plain, colored later by the extension).
 * Falls back to a single-column, borderless layout below NARROW_WIDTH so a
 * narrow terminal gets something readable instead of a garbled box.
 */
export function buildSplashLines({
  width,
  pkgVersion,
  piVersion,
  welcomeName,
  modelLine,
  cwdLine,
  tips = TIPS,
  status = [],
  colorMode = "truecolor",
  animation = "static",
  phase = 0,
  scheme,
}) {
  const title = `pi4MLA v${pkgVersion} · pi ${piVersion}`;
  const welcome = welcomeName ? `Welcome back, ${welcomeName}!` : "Welcome!";

  if (width < NARROW_WIDTH) {
    const lines = [title, "", welcome, "", modelLine, cwdLine, "", HEADING_TIPS];
    for (const t of tips) lines.push(`  ${t.cmd}  ${t.desc}`);
    if (status.length) {
      lines.push("", HEADING_STATUS);
      for (const s of status) lines.push(`  ${s}`);
    }
    return lines;
  }

  const boxWidth = Math.min(Math.max(width, NARROW_WIDTH), MAX_BOX_WIDTH);
  const innerWidth = boxWidth - 4; // "│ " + " │"
  const leftWidth = LEFT_WIDTH;
  const rightWidth = innerWidth - leftWidth - 3; // " │ " column divider

  const mascotLines = buildMascotLines("pi4MLA", { colorMode, padTo: leftWidth, animation, phase, scheme });
  const leftLines = [...mascotLines, "", welcome, "", modelLine, cwdLine];

  const rightLines = [...wrapToWidth(HEADING_TIPS, rightWidth)];
  for (const t of tips) {
    const prefix = `${t.cmd}  `;
    const [first, ...rest] = wrapToWidth(t.desc, Math.max(1, rightWidth - prefix.length));
    rightLines.push(`${prefix}${first ?? ""}`);
    for (const cont of rest) rightLines.push(`${" ".repeat(prefix.length)}${cont}`);
  }
  if (status.length) {
    rightLines.push("", ...wrapToWidth(HEADING_STATUS, rightWidth));
    for (const s of status) {
      for (const wrapped of wrapToWidth(s, rightWidth)) rightLines.push(wrapped);
    }
  }

  const rows = Math.max(leftLines.length, rightLines.length);
  const titleBar = ` ${title} `;
  const top = `┌${titleBar}${"─".repeat(Math.max(0, boxWidth - 2 - titleBar.length))}┐`;
  const bottom = `└${"─".repeat(boxWidth - 2)}┘`;

  const body = [];
  for (let i = 0; i < rows; i++) {
    const left = pad(leftLines[i] ?? "", leftWidth);
    const right = pad(rightLines[i] ?? "", rightWidth);
    body.push(`│ ${left} │ ${right} │`);
  }

  return [top, ...body, bottom];
}
