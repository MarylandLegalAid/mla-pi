// Tests for the zero-dependency FIGlet (.flf) parser + reduced-layout engine
// (scripts/splash/figlet-format.mjs). The Terrace fixture is the ground
// truth: test/fixtures/terrace-pi4mla.figlet.txt was captured once from the
// real npm `figlet` package (ad hoc dev install, never a project dependency -
// see scripts/splash-fonts.mjs) rendering "pi4MLA" in the vendored
// scripts/splash/fonts/Terrace.flf. Our own parser+layout must reproduce its
// ink mask (space vs non-space) exactly, since Terrace's oldLayout is -1
// (full-width, smush-free by design) - exactly the case this reduced-scope
// renderer is built to handle at parity with real figlet.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFlf, layoutWord, isSmushFree } from "../scripts/splash/figlet-format.mjs";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const FONT_PATH = join(REPO, "scripts", "splash", "fonts", "Terrace.flf");
const FIXTURE_PATH = join(REPO, "test", "fixtures", "terrace-pi4mla.figlet.txt");

const loadFont = () => parseFlf(readFileSync(FONT_PATH, "utf8"));
const inkMask = (grid) => grid.map((row) => row.map((f) => (f ? "#" : " ")).join(""));

test("parseFlf reads the Terrace header fields correctly", () => {
  const font = loadFont();
  assert.equal(font.height, 10);
  assert.equal(font.oldLayout, -1);
  assert.equal(font.fullLayout, 0);
  assert.equal(font.hardblank, "$");
});

test("isSmushFree is true for Terrace (oldLayout -1, no horizontal-smushing bit)", () => {
  assert.equal(isSmushFree(loadFont()), true);
});

test("isSmushFree is false for a font whose old_layout requires ink-pixel smushing", () => {
  assert.equal(isSmushFree({ oldLayout: 24, fullLayout: undefined }), false);
});

test("layoutWord('pi4MLA') in full-width mode exactly matches the captured real-figlet render", () => {
  const font = loadFont();
  const { grid } = layoutWord(font, "pi4MLA", { mode: "fullwidth" });
  const ours = inkMask(grid).map((r) => r.replace(/ +$/, ""));

  const reference = readFileSync(FIXTURE_PATH, "utf8").split("\n");
  const real = reference.map((line) => line.replace(/./gs, (c) => (c === " " ? " " : "#")).replace(/ +$/, ""));

  assert.equal(ours.length, real.length);
  for (let i = 0; i < real.length; i++) {
    assert.equal(ours[i], real[i], `row ${i} does not match the real-figlet reference`);
  }
});

test("a character outside the parsed 32-126 range is skipped, not thrown on", () => {
  const font = loadFont();
  assert.doesNotThrow(() => layoutWord(font, "PI☃4MLA"));
  const withUnknown = layoutWord(font, "PI☃4MLA").width;
  const withoutUnknown = layoutWord(font, "PI4MLA").width;
  assert.equal(withUnknown, withoutUnknown, "the unknown glyph should contribute no width");
});

test("a word made entirely of unsupported characters lays out to an empty, non-throwing grid", () => {
  const font = loadFont();
  assert.doesNotThrow(() => layoutWord(font, "☃☃☃"));
  assert.deepEqual(layoutWord(font, "☃☃☃"), { grid: [], width: 0, height: font.height });
});

test("kern mode never widens the layout versus full-width, and preserves every ink cell", () => {
  const font = loadFont();
  const full = layoutWord(font, "pi4MLA", { mode: "fullwidth" });
  const kern = layoutWord(font, "pi4MLA", { mode: "kern" });
  assert.ok(kern.width <= full.width);

  const countInk = (grid) => grid.reduce((n, row) => n + row.filter(Boolean).length, 0);
  assert.equal(countInk(kern.grid), countInk(full.grid), "kerning must only remove blank columns, never ink");
});

test("parseFlf throws a clear error on a non-FIGlet file instead of parsing garbage", () => {
  assert.throws(() => parseFlf("this is not a font file\njust some text\n"), /FIGlet/);
});
