// Pure layout/formatting for the pi startup splash (extensions/session-splash.js
// is the only file that talks to pi or the machine; everything here is plain
// data/color-mode strings in, ANSI text out - zero dependencies, unit-tested
// directly, no pi-tui import (that would break running under plain `node --test`).

// ------------------------------------------------------------------- ANSI helpers
const ESC = "\x1b[";
const RESET = `${ESC}0m`;
const ANSI_RE = /\x1b\[[0-9;]*m/g;

/** Rendered width, ignoring ANSI color codes (which are zero-width on screen). */
export function visibleWidth(str) {
  return str.replace(ANSI_RE, "").length;
}

// ------------------------------------------------------- pi4mla wordmark: pixel art
// A hand-authored 7-row bitmap per letter (thick, chunky strokes - a display
// wordmark, not real lowercase/uppercase metrics), composited with an
// outline pass, a top bevel highlight, a top-to-bottom gradient fill, and an
// offset drop shadow, then set on its own dark "badge" background so it reads
// clearly regardless of the user's pi theme (light or dark).
// Strokes are 3 cells wide on purpose: a 2-wide stroke has no cell with filled
// neighbors on every side, so the outline pass (below) would claim the entire
// glyph and no gradient/highlight would ever show through.
const GLYPH_HEIGHT = 9;
const GLYPHS = {
  P: [
    "#########",
    "###...###",
    "###...###",
    "#########",
    "###......",
    "###......",
    "###......",
    "###......",
    "###......",
  ],
  I: ["#####", ".###.", ".###.", ".###.", ".###.", ".###.", ".###.", ".###.", "#####"],
  4: [
    "###...###",
    "###...###",
    "###...###",
    "###...###",
    "#########",
    "......###",
    "......###",
    "......###",
    "......###",
  ],
  M: [
    "###.....###",
    "####...####",
    "#####.#####",
    "###########",
    "###.....###",
    "###.....###",
    "###.....###",
    "###.....###",
    "###.....###",
  ],
  L: ["###....", "###....", "###....", "###....", "###....", "###....", "###....", "###....", "#######"],
  A: [
    "....###....",
    "...#####...",
    "..##...##..",
    ".###...###.",
    "###########",
    "###.....###",
    "###.....###",
    "###.....###",
    "###.....###",
  ],
};
const GLYPH_GAP = 1;
const SHADOW_DY = 2;
const SHADOW_DX = 3;

const PALETTE = {
  bg: { rgb: { r: 12, g: 42, b: 115 }, code256: 18 },
  fillTop: { rgb: { r: 170, g: 235, b: 250 }, code256: 123 },
  fillBottom: { rgb: { r: 40, g: 160, b: 230 }, code256: 39 },
  highlight: { rgb: { r: 245, g: 253, b: 255 }, code256: 231 },
  outline: { rgb: { r: 2, g: 4, b: 10 }, code256: 232 },
  // Distinct from both outline (near-black) and bg (medium navy), so the
  // offset shadow reads as its own layer instead of vanishing into one or the other.
  shadow: { rgb: { r: 6, g: 18, b: 52 }, code256: 24 },
};

const lerp = (a, b, t) => Math.round(a + (b - a) * t);
const gradientRgb = (t) => ({
  r: lerp(PALETTE.fillTop.rgb.r, PALETTE.fillBottom.rgb.r, t),
  g: lerp(PALETTE.fillTop.rgb.g, PALETTE.fillBottom.rgb.g, t),
  b: lerp(PALETTE.fillTop.rgb.b, PALETTE.fillBottom.rgb.b, t),
});

/** One character cell: `fg` on the badge background, color-mode aware. */
function cell(fg, colorMode, ch) {
  if (colorMode === "256color") {
    return `${ESC}38;5;${fg.code256};48;5;${PALETTE.bg.code256}m${ch}${RESET}`;
  }
  const { r, g, b } = fg.rgb;
  const bg = PALETTE.bg.rgb;
  return `${ESC}38;2;${r};${g};${b};48;2;${bg.r};${bg.g};${bg.b}m${ch}${RESET}`;
}

/** Badge-background filler cell (used for empty pixels and right-padding). */
function bgCell(colorMode, ch = " ") {
  return cell(PALETTE.bg, colorMode, ch);
}

// The outline is drawn OUTSIDE the authored letterforms (dilation), not
// carved out of them (erosion) - the glyphs above are the fill, unmodified,
// exactly as authored. A 1px dark ring is added all the way around that
// silhouette, then the drop shadow traces the outer edge of ring-plus-fill.
const OUTLINE_PAD = 1;

function silhouette(word) {
  const letters = word.toUpperCase().split("");
  const glyphs = letters.map((ch) => GLYPHS[ch]).filter(Boolean);
  const letterWidths = glyphs.map((g) => g[0].length);
  const width = letterWidths.reduce((a, b) => a + b, 0) + GLYPH_GAP * Math.max(0, glyphs.length - 1);

  const grid = Array.from({ length: GLYPH_HEIGHT }, () => new Array(width).fill(false));
  let colOffset = 0;
  for (let li = 0; li < glyphs.length; li++) {
    const g = glyphs[li];
    for (let r = 0; r < GLYPH_HEIGHT; r++) {
      for (let c = 0; c < letterWidths[li]; c++) {
        if (g[r][c] === "#") grid[r][colOffset + c] = true;
      }
    }
    colOffset += letterWidths[li] + GLYPH_GAP;
  }
  return { grid, width };
}

/** Silhouette width/height in cells, before any padding. Pure geometry, no color. */
export function mascotCanvasSize(word) {
  const { width } = silhouette(word);
  return {
    width: width + 2 * OUTLINE_PAD + SHADOW_DX,
    height: GLYPH_HEIGHT + 2 * OUTLINE_PAD + SHADOW_DY,
  };
}

/**
 * Render `word` as a 3D pixel-art wordmark: a dark outline ring dilated
 * around the letterforms, a top bevel highlight, a vertical gradient fill,
 * and an offset drop shadow, all on their own dark badge. `padTo` right-pads
 * every row with more badge background so the badge fills a fixed column
 * width instead of hugging the glyphs.
 */
export function buildMascotLines(word, { colorMode = "truecolor", padTo } = {}) {
  const { grid, width: silhouetteWidth } = silhouette(word);

  const isFilled = (r, c) => r >= 0 && r < GLYPH_HEIGHT && c >= 0 && c < silhouetteWidth && grid[r][c];
  const NEIGHBORS = [
    [-1, 0], [1, 0], [0, -1], [0, 1],
    [-1, -1], [-1, 1], [1, -1], [1, 1],
  ];
  const isNearFilled = (r, c) => NEIGHBORS.some(([dr, dc]) => isFilled(r + dr, c + dc));
  const isGlyph = (r, c) => isFilled(r, c) || (!isFilled(r, c) && isNearFilled(r, c));

  const canvasWidth = silhouetteWidth + 2 * OUTLINE_PAD + SHADOW_DX;
  const canvasHeight = GLYPH_HEIGHT + 2 * OUTLINE_PAD + SHADOW_DY;
  const targetWidth = Math.max(padTo ?? canvasWidth, canvasWidth);

  const lines = [];
  for (let canvasR = 0; canvasR < canvasHeight; canvasR++) {
    const r = canvasR - OUTLINE_PAD;
    let line = "";
    for (let canvasC = 0; canvasC < canvasWidth; canvasC++) {
      const c = canvasC - OUTLINE_PAD;
      if (isFilled(r, c)) {
        if (r <= 1) {
          line += cell(PALETTE.highlight, colorMode, "█");
        } else {
          const t = (r - 2) / Math.max(1, GLYPH_HEIGHT - 1 - 2);
          const fg = { rgb: gradientRgb(t), code256: t < 0.5 ? PALETTE.fillTop.code256 : PALETTE.fillBottom.code256 };
          line += cell(fg, colorMode, "█");
        }
      } else if (isNearFilled(r, c)) {
        line += cell(PALETTE.outline, colorMode, "█");
      } else if (isGlyph(r - SHADOW_DY, c - SHADOW_DX)) {
        line += cell(PALETTE.shadow, colorMode, "█");
      } else {
        line += bgCell(colorMode);
      }
    }
    for (let c = canvasWidth; c < targetWidth; c++) line += bgCell(colorMode);
    lines.push(line);
  }
  return lines;
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
// A few columns wider than the wordmark itself, so the badge never gets sliced.
const LEFT_WIDTH = Math.max(36, mascotCanvasSize("PI4MLA").width);
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

  const mascotLines = buildMascotLines("PI4MLA", { colorMode, padTo: leftWidth });
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
