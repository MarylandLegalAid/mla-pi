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
// A hand-authored 11-row bitmap per letter (thick, chunky strokes - a display
// wordmark, not real lowercase/uppercase metrics), composited with an outline
// pass, a specular top-bevel highlight, a vertical white-cyan -> azure -> deep
// blue gradient fill, and an offset drop-shadow extrusion, then set on its own
// dark "badge" background so it reads clearly regardless of the user's pi theme.
//
// To match the reference wordmark the "p" and "i" are lowercase: "p" is a full
// bowl-and-stem, and "i" is a stem with its own square dot floating clear above
// it. The dot floats because a 3-row gap separates it from the stem - anything
// less and the two outline rings touch and the dot fuses to the stem.
//
// Only filled cells ever show gradient/highlight; empty cells adjacent to the
// silhouette become the outline. So counters (interior holes) read as a dark
// recess unless they are at least 3x3, in which case their center shows badge.
const GLYPH_HEIGHT = 11;
const GLYPHS = {
  p: [
    "########.",
    "#########",
    "###...###",
    "###...###",
    "###...###",
    "#########",
    "###......",
    "###......",
    "###......",
    "###......",
    "###......",
  ],
  i: [
    ".###.",
    ".###.",
    ".....",
    ".....",
    ".....",
    ".###.",
    ".###.",
    ".###.",
    ".###.",
    ".###.",
    ".###.",
  ],
  4: [
    "###...###",
    "###...###",
    "###...###",
    "###...###",
    "###...###",
    "#########",
    "......###",
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
    "###.....###",
    "###.....###",
  ],
  L: [
    "###....",
    "###....",
    "###....",
    "###....",
    "###....",
    "###....",
    "###....",
    "###....",
    "###....",
    "###....",
    "#######",
  ],
  A: [
    "....###....",
    "...#####...",
    "..##...##..",
    ".###...###.",
    "###.....###",
    "###########",
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
  // The vertical fill runs through three stops: an icy white-cyan just under the
  // specular highlight, a saturated azure through the middle, and a deep royal
  // blue at the bottom - the glossy, high-contrast blue of the reference.
  fillTop: { rgb: { r: 198, g: 244, b: 255 }, code256: 195 },
  fillMid: { rgb: { r: 48, g: 165, b: 246 }, code256: 39 },
  fillBottom: { rgb: { r: 18, g: 74, b: 200 }, code256: 26 },
  highlight: { rgb: { r: 248, g: 253, b: 255 }, code256: 231 },
  // Near-black navy, not pure black: a hair of blue keeps the ring reading as
  // part of the glossy blue letterform rather than a flat black cutout.
  outline: { rgb: { r: 5, g: 10, b: 30 }, code256: 232 },
  // A darker, saturated blue for the offset extrusion - distinct from both the
  // outline (near-black) and the bg (medium navy) so it reads as its own raised
  // side wall instead of vanishing into either.
  shadow: { rgb: { r: 8, g: 24, b: 82 }, code256: 17 },
};

const lerp = (a, b, t) => Math.round(a + (b - a) * t);
// Two-segment vertical gradient: fillTop -> fillMid over the upper half,
// fillMid -> fillBottom over the lower half (t in [0,1], top to bottom).
const gradientRgb = (t) => {
  const [a, b, u] = t < 0.5
    ? [PALETTE.fillTop, PALETTE.fillMid, t / 0.5]
    : [PALETTE.fillMid, PALETTE.fillBottom, (t - 0.5) / 0.5];
  return {
    r: lerp(a.rgb.r, b.rgb.r, u),
    g: lerp(a.rgb.g, b.rgb.g, u),
    b: lerp(a.rgb.b, b.rgb.b, u),
  };
};
const gradientCode256 = (t) =>
  t < 0.34 ? PALETTE.fillTop.code256 : t < 0.67 ? PALETTE.fillMid.code256 : PALETTE.fillBottom.code256;

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

// Look a character up case-insensitively so callers may pass "pi4MLA" or
// "PI4MLA" and land on the same authored glyph (the map keys carry the
// intended case: lowercase p/i, uppercase M/L/A).
const glyphFor = (ch) => GLYPHS[ch] ?? GLYPHS[ch.toLowerCase()] ?? GLYPHS[ch.toUpperCase()];

function silhouette(word) {
  const letters = word.split("");
  const glyphs = letters.map(glyphFor).filter(Boolean);
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
        // Specular top bevel: the topmost cell of every vertical run (the top
        // edge of the silhouette, including internal edges like the A crossbar)
        // catches a near-white highlight; everything below it takes the fill.
        if (!isFilled(r - 1, c)) {
          line += cell(PALETTE.highlight, colorMode, "█");
        } else {
          const t = r / (GLYPH_HEIGHT - 1);
          const fg = { rgb: gradientRgb(t), code256: gradientCode256(t) };
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

  const mascotLines = buildMascotLines("pi4MLA", { colorMode, padTo: leftWidth });
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
