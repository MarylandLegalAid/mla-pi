// Pure ink-mask -> colored-frame pipeline. Takes the boolean grid produced by
// figlet-format.mjs's layoutWord() and applies: a flat outline dilation, a
// horizontal blue gradient fill, and a halftone dither texture - then emits
// ANSI text rows. No forced background: non-ink cells are left as plain
// whitespace so the wordmark sits directly on whatever background the
// terminal actually has, in either of two color schemes (see
// splash.config.json's `schemes`): "dark" (white-ish outline, richer blue
// fill - for dark terminal backgrounds) or "light" (black-ish outline,
// paler blue fill - for light backgrounds). Neither scheme uses white and
// black at the same time: "dark" has no black anywhere, "light" has no white
// anywhere, so the wordmark reads clearly against either.
//
// Same function renders the static frame and every animation frame;
// animations are just a `phase` sweep through "pan" (gradient offset) or
// "shimmer" (dither offset). Zero dependencies, no terminal I/O - callers
// (scripts/session-splash.mjs's box layout and scripts/splash-cli.mjs's
// standalone animator) both sit on top of this.

const ESC = "\x1b[";
const RESET = `${ESC}0m`;

const OUTLINE_PAD = 1;

// 4x4 ordered (Bayer) dither matrix, normalized to [0, 1).
const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
].map((row) => row.map((v) => v / 16));

const UNICODE_SHADES = ["░", "▒", "▓", "█"];
const ASCII_SHADES = [".", "+", "*", "#"];

const lerp = (a, b, t) => Math.round(a + (b - a) * t);

/** Horizontal 3-stop gradient: stops[0] -> stops[1] over the first half, stops[1] -> stops[2] over the second. */
function gradientAt(stops, t) {
  const clamped = ((t % 1) + 1) % 1;
  const [a, b, u] = clamped < 0.5 ? [stops[0], stops[1], clamped / 0.5] : [stops[1], stops[2], (clamped - 0.5) / 0.5];
  return [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
}

/** Foreground-only cell (no background component - the terminal's own background shows through). */
function fgAnsi([r, g, b], colorMode, ch) {
  if (colorMode === "none") return ch;
  if (colorMode === "256") return `${ESC}38;5;${nearest256(r, g, b)}m${ch}${RESET}`;
  return `${ESC}38;2;${r};${g};${b}m${ch}${RESET}`;
}

// Minimal truecolor -> xterm-256 approximation: the 6x6x6 color cube (codes
// 16-231), which is all this splash's blue/white/black palette ever needs.
function nearest256(r, g, b) {
  const q = (v) => Math.round((Math.max(0, Math.min(255, v)) / 255) * 5);
  const [qr, qg, qb] = [q(r), q(g), q(b)];
  return 16 + 36 * qr + 6 * qg + qb;
}

const isInBounds = (grid, r, c) => r >= 0 && r < grid.length && c >= 0 && c < (grid[0]?.length ?? 0);
const NEIGHBORS = [
  [-1, 0], [1, 0], [0, -1], [0, 1],
  [-1, -1], [-1, 1], [1, -1], [1, 1],
];

/** Resolve a scheme name (or the config's default) to its `{ outline, stops }` colors. */
function resolveScheme(config, scheme) {
  const name = scheme ?? config.defaultScheme;
  const resolved = config.schemes?.[name];
  if (!resolved) throw new Error(`unknown splash color scheme: ${name}`);
  return resolved;
}

/** Frames needed to cover the configured animation duration at its configured fps. */
export function frameCount(config) {
  return Math.max(1, Math.round((config.animation.durationMs / 1000) * config.animation.fps));
}

export function tickIntervalMs(config) {
  return 1000 / config.animation.fps;
}

/** Repeating 0..1 progress for animation tick `tick` (0-based). */
export function phaseForTick(tick, config) {
  return (tick % frameCount(config)) / frameCount(config);
}

/**
 * Render one frame of `grid` (as produced by figlet-format.mjs's layoutWord)
 * to an array of ANSI (or plain) text rows.
 *
 * `animation`: "static" (phase ignored), "pan" (phase shifts the gradient
 * horizontally), or "shimmer" (phase shifts the dither matrix's phase).
 * `scheme`: "dark" | "light" (see splash.config.json's `schemes`); defaults
 * to `config.defaultScheme`.
 * `colorMode`: "truecolor" | "256" | "none".
 * `unicode`: use block-shade characters when true, an ASCII ramp when false.
 * `padTo`: right-pad every row with plain whitespace to at least this width.
 */
export function renderFrame(
  grid,
  config,
  { animation = "static", phase = 0, scheme, colorMode = "truecolor", unicode = true, padTo } = {},
) {
  const height = grid.length;
  const width = grid[0]?.length ?? 0;
  const isFilled = (r, c) => isInBounds(grid, r, c) && grid[r][c];
  const isNearFilled = (r, c) => NEIGHBORS.some(([dr, dc]) => isFilled(r + dr, c + dc));

  const canvasWidth = width + 2 * OUTLINE_PAD;
  const canvasHeight = height + 2 * OUTLINE_PAD;
  const targetWidth = Math.max(padTo ?? canvasWidth, canvasWidth);

  const { outline, stops } = resolveScheme(config, scheme);
  const gradientPhase = animation === "pan" ? phase : 0;
  const ditherPhase = animation === "shimmer" ? phase : 0;
  const shades = unicode ? UNICODE_SHADES : ASCII_SHADES;

  const rows = [];
  for (let canvasR = 0; canvasR < canvasHeight; canvasR++) {
    const r = canvasR - OUTLINE_PAD;
    let line = "";
    for (let canvasC = 0; canvasC < canvasWidth; canvasC++) {
      const c = canvasC - OUTLINE_PAD;
      if (isFilled(r, c)) {
        const t = width <= 1 ? 0 : c / (width - 1) + gradientPhase;
        const rgb = gradientAt(stops, t);
        const rr = (r + Math.floor(ditherPhase * 4)) % 4;
        const cc = (c + Math.floor(ditherPhase * 4)) % 4;
        const threshold = BAYER4[((rr % 4) + 4) % 4][((cc % 4) + 4) % 4];
        // Subtle halftone: mostly solid, occasionally one shade lighter.
        const level = threshold < 0.25 ? 2 : 3;
        line += fgAnsi(rgb, colorMode, shades[level]);
      } else if (isNearFilled(r, c)) {
        line += fgAnsi(outline, colorMode, unicode ? "█" : "#");
      } else {
        line += " "; // no forced background - the terminal's own bg shows through
      }
    }
    line += " ".repeat(Math.max(0, targetWidth - canvasWidth));
    rows.push(line);
  }
  return rows;
}

/** Canvas size (before any padTo), matching what renderFrame would produce. */
export function frameCanvasSize(grid) {
  const height = grid.length;
  const width = grid[0]?.length ?? 0;
  return {
    width: width + 2 * OUTLINE_PAD,
    height: height + 2 * OUTLINE_PAD,
  };
}
