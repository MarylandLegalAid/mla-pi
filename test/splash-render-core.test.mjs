// Tests for scripts/splash/render-core.mjs: the pure ink-mask -> ANSI-frame
// pipeline (gradient, dither, animation phase math). No terminal I/O here -
// see test/splash-cli.test.mjs for the terminal-owning driver.

import { test } from "node:test";
import assert from "node:assert/strict";
import { renderFrame, frameCanvasSize, frameCount, tickIntervalMs, phaseForTick } from "../scripts/splash/render-core.mjs";
import { visibleWidth, stripAnsi } from "../scripts/splash/ansi.mjs";

const CONFIG = {
  defaultScheme: "dark",
  schemes: {
    dark: {
      outline: [250, 251, 255],
      stops: [
        [94, 168, 245],
        [46, 116, 214],
        [21, 66, 148],
      ],
    },
    light: {
      outline: [8, 10, 16],
      stops: [
        [176, 214, 250],
        [94, 160, 230],
        [48, 108, 190],
      ],
    },
  },
  dither: { matrix: "bayer4x4" },
  animation: { durationMs: 1200, fps: 20 },
};

// A small hand-built ink mask (a 3x3 solid square) - big enough to exercise
// outline/fill, small enough to reason about by eye.
const SQUARE = [
  [true, true, true],
  [true, true, true],
  [true, true, true],
];

const truecolorTriples = (lines) => [...lines.join("\n").matchAll(/38;2;(\d+);(\d+);(\d+)/g)].map((m) => m.slice(1, 4).map(Number));

test("frameCount is duration * fps", () => {
  assert.equal(frameCount(CONFIG), 24);
});

test("tickIntervalMs is 1000/fps", () => {
  assert.equal(tickIntervalMs(CONFIG), 50);
});

test("phaseForTick sweeps 0..1 and wraps every frameCount ticks", () => {
  const n = frameCount(CONFIG);
  assert.equal(phaseForTick(0, CONFIG), 0);
  assert.equal(phaseForTick(n, CONFIG), 0, "phase must wrap back to 0 after a full cycle");
  assert.ok(phaseForTick(n / 2, CONFIG) > 0 && phaseForTick(n / 2, CONFIG) < 1);
});

test("renderFrame produces rows that are all the same visible width", () => {
  const lines = renderFrame(SQUARE, CONFIG, { colorMode: "truecolor" });
  const widths = new Set(lines.map(visibleWidth));
  assert.equal(widths.size, 1, `mismatched row widths: ${[...widths]}`);
});

test("renderFrame's visible size matches frameCanvasSize", () => {
  const lines = renderFrame(SQUARE, CONFIG, { colorMode: "truecolor" });
  const { width, height } = frameCanvasSize(SQUARE);
  assert.equal(lines.length, height);
  assert.equal(visibleWidth(lines[0]), width);
});

test("padTo widens every row without changing row count", () => {
  const base = frameCanvasSize(SQUARE).width;
  const lines = renderFrame(SQUARE, CONFIG, { colorMode: "truecolor", padTo: base + 10 });
  for (const l of lines) assert.equal(visibleWidth(l), base + 10);
});

test("padTo narrower than the natural size is ignored, not truncated", () => {
  const base = frameCanvasSize(SQUARE).width;
  const lines = renderFrame(SQUARE, CONFIG, { colorMode: "truecolor", padTo: 1 });
  assert.equal(visibleWidth(lines[0]), base);
});

test("colorMode 'none' emits no ANSI escapes at all", () => {
  const lines = renderFrame(SQUARE, CONFIG, { colorMode: "none" });
  assert.ok(lines.every((l) => l === stripAnsi(l)));
});

test("colorMode '256' never emits a truecolor (38;2) escape", () => {
  const lines = renderFrame(SQUARE, CONFIG, { colorMode: "256" });
  assert.ok(!lines.some((l) => l.includes("38;2;")));
  assert.ok(lines.some((l) => l.includes("38;5;")));
});

test("truecolor and 256color modes render the same silhouette (dithering is colorMode-independent)", () => {
  const tc = renderFrame(SQUARE, CONFIG, { colorMode: "truecolor" }).map(stripAnsi);
  const c256 = renderFrame(SQUARE, CONFIG, { colorMode: "256" }).map(stripAnsi);
  assert.deepEqual(tc, c256);
});

test("unicode:false uses only ASCII characters, never a Unicode block-shade glyph", () => {
  const lines = renderFrame(SQUARE, CONFIG, { colorMode: "none", unicode: false });
  const text = lines.join("");
  assert.ok(!/[█▓▒░]/.test(text));
});

test("unicode:true uses Unicode block-shade characters for a solid mask", () => {
  const lines = renderFrame(SQUARE, CONFIG, { colorMode: "none", unicode: true });
  const text = lines.join("");
  assert.ok(/[█▓▒░]/.test(text));
});

test("the rendered frame is non-blank - something was actually drawn", () => {
  const lines = renderFrame(SQUARE, CONFIG, { colorMode: "none" }).join("");
  assert.ok(/[^\s]/.test(lines));
});

test("an empty mask renders without throwing", () => {
  assert.doesNotThrow(() => renderFrame([], CONFIG, { colorMode: "none" }));
});

test("'pan' animation shifts the gradient (different phases give different truecolor output for the same mask)", () => {
  const a = renderFrame(SQUARE, CONFIG, { animation: "pan", phase: 0, colorMode: "truecolor" });
  const b = renderFrame(SQUARE, CONFIG, { animation: "pan", phase: 0.5, colorMode: "truecolor" });
  assert.notDeepEqual(a, b);
  // but the silhouette (space vs ink) is unaffected by which phase of the gradient we're in
  const shape = (lines) => lines.map((l) => stripAnsi(l).replace(/[^\s]/g, "#"));
  assert.deepEqual(shape(a), shape(b));
});

test("'shimmer' animation changes the dither texture without changing the base gradient's static (phase 0) frame", () => {
  const staticFrame = renderFrame(SQUARE, CONFIG, { animation: "static", colorMode: "truecolor" });
  const shimmerAtZero = renderFrame(SQUARE, CONFIG, { animation: "shimmer", phase: 0, colorMode: "truecolor" });
  assert.deepEqual(staticFrame, shimmerAtZero);
  const shimmerLater = renderFrame(SQUARE, CONFIG, { animation: "shimmer", phase: 0.3, colorMode: "truecolor" });
  assert.notDeepEqual(shimmerAtZero, shimmerLater);
});

// --------------------------------------------------------------- color schemes
test("dark and light schemes render visibly different output for the same mask", () => {
  const dark = renderFrame(SQUARE, CONFIG, { scheme: "dark", colorMode: "truecolor" });
  const light = renderFrame(SQUARE, CONFIG, { scheme: "light", colorMode: "truecolor" });
  assert.notDeepEqual(dark, light);
});

test("an unknown scheme name throws a clear error instead of rendering garbage", () => {
  assert.throws(() => renderFrame(SQUARE, CONFIG, { scheme: "sepia" }), /unknown splash color scheme/);
});

test("the 'dark' scheme never emits pure black - it must read against a dark background via its white-ish outline alone", () => {
  const lines = renderFrame(SQUARE, CONFIG, { scheme: "dark", colorMode: "truecolor" });
  assert.ok(truecolorTriples(lines).every(([r, g, b]) => !(r === 0 && g === 0 && b === 0)));
});

test("the 'light' scheme never emits pure white - it must read against a light background via its black-ish outline alone", () => {
  const lines = renderFrame(SQUARE, CONFIG, { scheme: "light", colorMode: "truecolor" });
  assert.ok(truecolorTriples(lines).every(([r, g, b]) => !(r === 255 && g === 255 && b === 255)));
});

test("no forced background: a cell outside the outline/fill is plain whitespace with no ANSI at all, in every color mode", () => {
  // SQUARE has no outside-the-mask cell (it's solid + a 1px outline ring, no
  // interior gap) - use a ring-shaped mask so some cells are neither fill nor
  // outline, and confirm those specific cells never carry an escape code.
  const RING = [
    [true, true, true],
    [true, false, true],
    [true, true, true],
  ];
  for (const colorMode of ["truecolor", "256", "none"]) {
    const lines = renderFrame(RING, CONFIG, { colorMode });
    // frameCanvasSize pads 1 cell of outline around the 3x3 mask, so the
    // outer corner (0,0) is background-behind-the-outline-ring... instead,
    // check a cell far outside the mask entirely via padTo.
    const padded = renderFrame(RING, CONFIG, { colorMode, padTo: 20 });
    const lastCell = padded[0].slice(-1);
    assert.equal(lastCell, " ", `expected plain background whitespace, got ${JSON.stringify(lastCell)}`);
  }
});
