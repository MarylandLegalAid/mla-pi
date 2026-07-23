// Pure layout/formatting functions in scripts/session-splash.mjs, imported
// directly and unit-tested - same pattern as check-routing-fresh.test.mjs's
// import of compare(). extensions/session-splash.js (the impure glue that
// actually talks to pi/the machine) is exercised by hand; see docs/verification.md.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { REPO } from "./support/harness.mjs";
import {
  buildMascotLines,
  mascotCanvasSize,
  visibleWidth,
  shortenPath,
  formatModelLine,
  authStatusLine,
  packagesStatusLine,
  buildSplashLines,
  HEADING_TIPS,
  HEADING_STATUS,
  NARROW_WIDTH,
  MAX_BOX_WIDTH,
} from "../scripts/session-splash.mjs";

const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");

// ------------------------------------------------------------------ visibleWidth
test("visibleWidth ignores ANSI color codes", () => {
  const plain = "hello";
  const colored = `\x1b[38;2;1;2;3mhello\x1b[0m`;
  assert.equal(visibleWidth(plain), 5);
  assert.equal(visibleWidth(colored), 5);
});

// -------------------------------------------------------------------- buildMascotLines
test("buildMascotLines produces rows that are all the same visible width", () => {
  const lines = buildMascotLines("PI4MLA", { colorMode: "truecolor" });
  const widths = new Set(lines.map(visibleWidth));
  assert.equal(widths.size, 1, `mascot rows have mismatched widths: ${[...widths]}`);
});

test("buildMascotLines' visible size matches mascotCanvasSize", () => {
  const lines = buildMascotLines("PI4MLA", { colorMode: "truecolor" });
  const { width, height } = mascotCanvasSize("PI4MLA");
  assert.equal(lines.length, height);
  assert.equal(visibleWidth(lines[0]), width);
});

test("padTo widens every row without changing the row count", () => {
  const base = mascotCanvasSize("PI4MLA").width;
  const lines = buildMascotLines("PI4MLA", { colorMode: "truecolor", padTo: base + 10 });
  for (const l of lines) assert.equal(visibleWidth(l), base + 10);
});

test("padTo narrower than the natural size is ignored, not truncated", () => {
  const base = mascotCanvasSize("PI4MLA").width;
  const lines = buildMascotLines("PI4MLA", { colorMode: "truecolor", padTo: 1 });
  assert.equal(visibleWidth(lines[0]), base);
});

test("a character outside the FIGlet font's parsed range is skipped rather than throwing", () => {
  assert.doesNotThrow(() => buildMascotLines("PI☃4MLA", { colorMode: "truecolor" }));
});

// The wordmark is now a real FIGlet font (scripts/splash/fonts/Terrace.flf),
// which - unlike the old hand-authored bitmap - has genuinely distinct
// upper/lowercase glyphs, so rendering is case-sensitive by design; see
// scripts/splash/figlet-format.mjs's module comment.
test("rendering is case-sensitive: pi4MLA and PI4MLA differ", () => {
  const mixed = buildMascotLines("pi4MLA", { colorMode: "truecolor" });
  const upper = buildMascotLines("PI4MLA", { colorMode: "truecolor" });
  assert.notDeepEqual(mixed, upper);
});

test("both truecolor and 256color modes render the same silhouette", () => {
  const tc = buildMascotLines("PI4MLA", { colorMode: "truecolor" }).map(stripAnsi);
  const c256 = buildMascotLines("PI4MLA", { colorMode: "256color" }).map(stripAnsi);
  assert.deepEqual(tc, c256);
});

test("256color mode never emits a truecolor (38;2) escape", () => {
  const lines = buildMascotLines("PI4MLA", { colorMode: "256color" });
  assert.ok(!lines.some((l) => l.includes("38;2;")));
});

test("the rendered silhouette is non-blank - something was actually drawn", () => {
  const stripped = buildMascotLines("PI4MLA", { colorMode: "truecolor" }).map(stripAnsi);
  assert.ok(stripped.some((l) => l.includes("█")));
});

// ------------------------------------------------------------------ shortenPath
test("shortenPath collapses the home directory to ~", () => {
  assert.equal(shortenPath("/home/john/repos/pi-mla", "/home/john"), "~/repos/pi-mla");
});

test("shortenPath leaves paths outside home untouched", () => {
  assert.equal(shortenPath("/srv/app", "/home/john"), "/srv/app");
});

test("shortenPath treats home itself as ~", () => {
  assert.equal(shortenPath("/home/john", "/home/john"), "~");
});

test("shortenPath does not collapse a sibling directory that merely shares a prefix", () => {
  assert.equal(shortenPath("/home/johnson/x", "/home/john"), "/home/johnson/x");
});

// --------------------------------------------------------------- formatModelLine
test("formatModelLine includes the thinking level when present", () => {
  assert.equal(
    formatModelLine({ name: "DeepSeek V4 Pro", thinkingLevel: "high" }),
    "DeepSeek V4 Pro · high effort",
  );
});

test("formatModelLine falls back gracefully when no model is configured", () => {
  assert.match(formatModelLine({}), /no model configured/);
});

// --------------------------------------------------------------- status lines
test("authStatusLine reports ok when a key is present", () => {
  assert.equal(authStatusLine({ hasKey: true }), "OpenRouter auth: ok");
});

test("authStatusLine names the missing case", () => {
  assert.match(authStatusLine({ hasKey: false }), /missing/);
});

test("packagesStatusLine reports ok with nothing missing", () => {
  assert.equal(packagesStatusLine({ missing: [] }), "companion packages: ok");
});

test("packagesStatusLine names what is missing", () => {
  assert.match(packagesStatusLine({ missing: ["pi-web-access"] }), /pi-web-access/);
});

// ------------------------------------------------------------------ buildSplashLines
const baseArgs = {
  pkgVersion: "0.1.0",
  piVersion: "0.81.1",
  welcomeName: "John",
  modelLine: "DeepSeek V4 Pro · high effort",
  cwdLine: "~/repos/pi-mla",
  status: ["OpenRouter auth: ok", "companion packages: ok"],
};

test("at a normal width, every line of the box is exactly boxWidth wide", () => {
  const lines = buildSplashLines({ ...baseArgs, width: NARROW_WIDTH + 15 });
  const widths = new Set(lines.map(visibleWidth));
  assert.equal(widths.size, 1, `ragged box: widths ${[...widths]}`);
});

test("the box width is capped even on a very wide terminal", () => {
  const lines = buildSplashLines({ ...baseArgs, width: MAX_BOX_WIDTH + 200 });
  assert.ok(
    visibleWidth(lines[0]) <= MAX_BOX_WIDTH,
    `expected <=${MAX_BOX_WIDTH}, got ${visibleWidth(lines[0])}`,
  );
});

test("below the narrow threshold, falls back to a borderless single column", () => {
  const lines = buildSplashLines({ ...baseArgs, width: NARROW_WIDTH - 10 });
  assert.ok(!lines.some((l) => l.includes("┌")), "should not draw a box border");
  assert.ok(lines.some((l) => l.includes("Welcome back, John!")));
  assert.ok(lines.some((l) => l.includes("/skill:plan")));
});

test("a long tip description wraps without breaking box alignment", () => {
  const lines = buildSplashLines({ ...baseArgs, width: NARROW_WIDTH + 2 });
  const widths = new Set(lines.map(visibleWidth));
  assert.equal(widths.size, 1, `ragged box: widths ${[...widths]}`);
});

test("missing welcomeName falls back to a generic greeting", () => {
  const lines = buildSplashLines({ ...baseArgs, welcomeName: undefined, width: NARROW_WIDTH + 15 });
  assert.ok(lines.some((l) => l.includes("Welcome!")));
  assert.ok(!lines.some((l) => l.includes("Welcome back")));
});

test("the box includes both section headings verbatim, for the extension's colorizer to target", () => {
  const lines = buildSplashLines({ ...baseArgs, width: NARROW_WIDTH + 15 });
  assert.ok(lines.some((l) => l.includes(HEADING_TIPS)));
  assert.ok(lines.some((l) => l.includes(HEADING_STATUS)));
});

test("the mascot is never truncated inside the box, at a normal or narrow-but-boxed width", () => {
  for (const width of [NARROW_WIDTH, NARROW_WIDTH + 15, MAX_BOX_WIDTH]) {
    const lines = buildSplashLines({ ...baseArgs, width }).map(stripAnsi);
    // buildSplashLines always renders the literal "pi4MLA" (see its call to
    // buildMascotLines below) - rendering is case-sensitive now (real FIGlet
    // glyphs, not the old case-folded hand-authored bitmap), so this must
    // match that exact case to compare like with like.
    const mascotRows = buildMascotLines("pi4MLA", { colorMode: "truecolor" }).map(stripAnsi);
    for (const glyphRow of mascotRows) {
      assert.ok(
        lines.some((l) => l.includes(glyphRow)),
        `mascot row truncated or missing at width ${width}: ${JSON.stringify(glyphRow)}`,
      );
    }
  }
});

test("respects a colorMode passed through from the caller", () => {
  const lines = buildSplashLines({ ...baseArgs, width: NARROW_WIDTH + 15, colorMode: "256color" });
  assert.ok(!lines.some((l) => l.includes("38;2;")), "should not emit truecolor escapes");
  assert.ok(lines.some((l) => l.includes("38;5;")), "should emit 256-color escapes");
});

// -------------------------------------------------- extension <-> pi package API
// scripts/session-splash.mjs (everything above) is pure and pi-agnostic. The glue
// in extensions/session-splash.js imports named symbols from the pi package, and pi
// only re-exports a subset of its config helpers from the package entry point - a
// name that exists in pi's source but isn't re-exported (getAuthPath/getSettingsPath
// were exactly this) is a link-time error that silently disables the whole splash
// and drops back to pi's built-in header. This guards that seam by reading the
// extension's real import list and checking the installed pi actually exports each
// name. Skips when pi isn't installed globally, same rule as the shellcheck test.

/** The identifiers extensions/session-splash.js imports from the pi package. */
function importedPiNames() {
  const src = readFileSync(join(REPO, "extensions", "session-splash.js"), "utf8");
  const m = src.match(/import\s*\{([^}]*)\}\s*from\s*["']@earendil-works\/pi-coding-agent["']/);
  assert.ok(m, "could not find the pi-package import in extensions/session-splash.js");
  return m[1]
    .split(",")
    .map((s) => s.trim().split(/\s+as\s+/)[0].trim()) // drop any `x as y` alias
    .filter(Boolean);
}

/** file:// entry point of the globally installed pi package, or null if not installed. */
function installedPiEntry() {
  let root;
  try {
    root = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
  const dir = join(root, "@earendil-works", "pi-coding-agent");
  if (!existsSync(join(dir, "package.json"))) return null;
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const entry = pkg.exports?.["."]?.import ?? pkg.main;
  return pathToFileURL(join(dir, entry)).href;
}

test("every symbol the splash extension imports from pi is exported by the installed pi", async (t) => {
  const entry = installedPiEntry();
  if (!entry) return t.skip("pi is not installed globally on this machine");

  const ns = await import(entry);
  const missing = importedPiNames().filter((name) => !(name in ns));
  assert.deepEqual(
    missing,
    [],
    `the installed pi does not export: ${missing.join(", ")} - the splash extension would fail to load`,
  );
});
