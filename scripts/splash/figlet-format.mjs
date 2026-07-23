// Zero-dependency FIGlet (.flf) font file parser + a reduced-scope layout
// engine. This exists so the splash wordmark can come from a real,
// off-the-shelf FIGlet font instead of hand-drawn glyphs, without adding an
// npm runtime dependency (scripts/validate.mjs forbids that: "no npm
// dependencies allowed: scripts must run on stock Node", and install.sh never
// runs `npm install` inside this repo on a staff machine).
//
// Deliberately reduced scope: only the two smush-free FIGfont layout modes
// are implemented - "full width" (glyphs placed at their authored width, no
// overlap) and "kern" (trim only mutually-blank columns at a glyph boundary,
// never merging ink pixels). The 12-rule ink-smushing algorithm is NOT
// implemented. Font selection is expected to stick to fonts whose header
// declares `oldLayout <= 0` (full-width or kerning by design) - see
// scripts/splash-fonts.mjs, which filters the contact sheet to exactly that
// set. For those fonts this renderer is at parity with real figlet.

const REQUIRED_CODES = Array.from({ length: 126 - 32 + 1 }, (_, i) => 32 + i); // ASCII 32..126

/**
 * Parse a FIGlet .flf font file's text into `{ height, oldLayout, fullLayout, glyphs }`.
 * `glyphs` is a Map from character to an array of `height` equal-length strings
 * (hardblank already substituted with a space; end-marks already stripped).
 */
export function parseFlf(source) {
  const lines = source.split(/\r\n|\r|\n/);
  const header = lines[0];
  const m = header.match(/^flf2.(.)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)(?:\s+(-?\d+)\s+(-?\d+))?/);
  if (!m) throw new Error("not a FIGlet font file (bad header)");

  const [, hardblank, heightStr, , , oldLayoutStr, commentLinesStr, , fullLayoutStr] = m;
  const height = Number(heightStr);
  const oldLayout = Number(oldLayoutStr);
  const commentLines = Number(commentLinesStr);
  const fullLayout = fullLayoutStr === undefined ? undefined : Number(fullLayoutStr);

  let cursor = 1 + commentLines;
  let endmark; // determined from the first glyph line we see, reused for all
  const glyphs = new Map();

  for (const code of REQUIRED_CODES) {
    const block = lines.slice(cursor, cursor + height);
    cursor += height;
    if (block.length < height) break; // truncated/short font file - stop gracefully

    if (endmark === undefined) {
      const last = block[0].trimEnd();
      endmark = last.slice(-1);
    }
    const endmarkRe = new RegExp(`\\${endmark}+$`);
    const stripped = block.map((line) => line.replace(endmarkRe, ""));
    const width = Math.max(0, ...stripped.map((l) => l.length));
    const padded = stripped.map((l) => l.padEnd(width, " "));
    const hardblankRe = new RegExp(`\\${hardblank}`, "g");
    const glyph = padded.map((l) => l.replace(hardblankRe, " "));
    glyphs.set(String.fromCharCode(code), glyph);
  }

  return { hardblank, height, oldLayout, fullLayout, glyphs };
}

/** True if `font` was authored for a layout our reduced renderer can reproduce exactly. */
export function isSmushFree(font) {
  const HORIZONTAL_SMUSHING_BIT = 128;
  if (font.oldLayout > 0) return false;
  if (Number.isFinite(font.fullLayout) && (font.fullLayout & HORIZONTAL_SMUSHING_BIT) !== 0) return false;
  return true;
}

/** Number of fully-blank columns at the right edge of a glyph's rows. */
function trailingBlankCols(rows) {
  const width = rows[0]?.length ?? 0;
  let n = 0;
  for (let c = width - 1; c >= 0; c--) {
    if (!rows.every((r) => r[c] === " ")) break;
    n++;
  }
  return n;
}

/** Number of fully-blank columns at the left edge of a glyph's rows. */
function leadingBlankCols(rows) {
  const width = rows[0]?.length ?? 0;
  let n = 0;
  for (let c = 0; c < width; c++) {
    if (!rows.every((r) => r[c] === " ")) break;
    n++;
  }
  return n;
}

/**
 * Lay `word` out using `font`'s glyphs into a boolean ink mask.
 * `mode: "fullwidth"` places glyphs back to back at their authored width.
 * `mode: "kern"` additionally overlaps mutually-blank columns at each
 * boundary (never merging ink pixels from adjacent glyphs).
 * Characters missing from the font are skipped, not thrown on.
 */
export function layoutWord(font, word, { mode = "fullwidth" } = {}) {
  const glyphRows = [...word].map((ch) => font.glyphs.get(ch)).filter(Boolean);
  if (glyphRows.length === 0) return { grid: [], width: 0, height: font.height };

  const overlaps =
    mode === "kern"
      ? glyphRows.map((rows, i) => {
          if (i === 0) return 0;
          const prev = glyphRows[i - 1];
          return Math.min(trailingBlankCols(prev), leadingBlankCols(rows));
        })
      : glyphRows.map(() => 0);

  let width = 0;
  const offsets = [];
  for (let i = 0; i < glyphRows.length; i++) {
    width -= overlaps[i];
    offsets.push(width);
    width += glyphRows[i][0].length;
  }

  const grid = Array.from({ length: font.height }, () => new Array(width).fill(false));
  for (let i = 0; i < glyphRows.length; i++) {
    const rows = glyphRows[i];
    const offset = offsets[i];
    for (let r = 0; r < font.height; r++) {
      const row = rows[r];
      for (let c = 0; c < row.length; c++) {
        if (row[c] !== " ") grid[r][offset + c] = true;
      }
    }
  }

  return { grid, width, height: font.height };
}
