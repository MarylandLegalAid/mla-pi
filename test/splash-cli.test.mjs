// Tests for the standalone, terminal-owning scripts/splash-cli.mjs: cursor
// restoration (including on SIGINT/SIGTERM/exceptions), narrow-terminal
// fallback, and NO_COLOR/noninteractive behavior. There is no real TTY in a
// test run, so:
//   - width/color are driven by explicit --width/--color flags, not
//     terminal detection (see scripts/splash-cli.mjs's `--width`/`--color`).
//   - the animation/cursor-control code path (which real noninteractive
//     output skips entirely) is exercised via the test-only
//     --debug-force-tty flag; see harness.spawnKillOnFirstOutput for why
//     SIGINT/SIGTERM specifically need a spawned (not execFileSync'd) child.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO, run, spawnKillOnFirstOutput } from "./support/harness.mjs";
import { mascotCanvasSize } from "../scripts/session-splash.mjs";
import { frameCount } from "../scripts/splash/render-core.mjs";

const CLI = join(REPO, "scripts", "splash-cli.mjs");
const SPLASH_CONFIG = JSON.parse(readFileSync(join(REPO, "scripts", "splash", "splash.config.json"), "utf8"));

const HIDE = "\x1b[?25l";
const SHOW = "\x1b[?25h";
const ANSI_RE = /\x1b\[[0-9;]*m/;

// ------------------------------------------------------------- narrow terminal
test("under minColumns, prints a compact one-line fallback with no ANSI at all", () => {
  const r = run(CLI, ["static", "--width", "40"]);
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), SPLASH_CONFIG.text);
  assert.ok(!ANSI_RE.test(r.stdout));
});

test("at or above minColumns, prints the full multi-row wordmark", () => {
  const r = run(CLI, ["static", "--width", "200"]);
  assert.equal(r.code, 0);
  const { height } = mascotCanvasSize(SPLASH_CONFIG.text);
  assert.equal(r.stdout.split("\n").filter(Boolean).length, height);
});

// ------------------------------------------------------------------- NO_COLOR
test("NO_COLOR suppresses all ANSI color, even with --color=always", () => {
  const r = run(CLI, ["static", "--width", "200", "--color=always"], { env: { NO_COLOR: "1", COLORTERM: "truecolor" } });
  assert.equal(r.code, 0);
  assert.ok(!ANSI_RE.test(r.stdout), "NO_COLOR must win over an explicit --color=always");
});

test("without NO_COLOR set, --color=always does produce ANSI truecolor output", () => {
  const r = run(CLI, ["static", "--width", "200", "--color=always"], { env: { NO_COLOR: undefined, COLORTERM: "truecolor" } });
  assert.equal(r.code, 0);
  assert.ok(r.stdout.includes("38;2;"), "expected truecolor escapes when NO_COLOR is unset and color is forced on");
});

// --------------------------------------------------------- noninteractive output
test("piped (non-TTY) output never emits cursor-control escapes, even for an animated subcommand", () => {
  const r = run(CLI, ["pan", "--width", "200", "--color=never"]);
  assert.equal(r.code, 0);
  assert.ok(!r.stdout.includes(HIDE) && !r.stdout.includes(SHOW));
});

// --------------------------------------------------------------- cursor safety
test("cursor is hidden then reliably restored on SIGINT mid-animation", async () => {
  const r = await spawnKillOnFirstOutput(CLI, ["pan", "--width", "200", "--color=never", "--debug-force-tty"], {
    signal: "SIGINT",
  });
  assert.equal(r.code, 130, "SIGINT handler should exit with the conventional 128+SIGINT code");
  assert.ok(r.stdout.includes(HIDE));
  assert.ok(r.stdout.lastIndexOf(SHOW) > r.stdout.lastIndexOf(HIDE), "cursor must be shown again after being hidden");
});

test("cursor is hidden then reliably restored on SIGTERM mid-animation", async () => {
  const r = await spawnKillOnFirstOutput(CLI, ["shimmer", "--width", "200", "--color=never", "--debug-force-tty"], {
    signal: "SIGTERM",
  });
  assert.equal(r.code, 143, "SIGTERM handler should exit with the conventional 128+SIGTERM code");
  assert.ok(r.stdout.includes(HIDE));
  assert.ok(r.stdout.lastIndexOf(SHOW) > r.stdout.lastIndexOf(HIDE));
});

test("cursor is restored even when the render loop throws (isolates the try/finally path from the signal path)", () => {
  const r = run(CLI, [
    "pan",
    "--width",
    "200",
    "--color=never",
    "--debug-force-tty",
    "--debug-instant",
    "--debug-throw-after-frame=2",
  ]);
  assert.notEqual(r.code, 0);
  const combined = r.stdout;
  assert.ok(combined.includes(HIDE));
  assert.ok(combined.lastIndexOf(SHOW) > combined.lastIndexOf(HIDE));
});

// -------------------------------------------------------------------- preview
test("`preview` cycles through static, pan, and shimmer with the expected total frame count and real variety", () => {
  const r = run(CLI, ["preview", "--width", "200", "--color=never", "--debug-force-tty", "--debug-instant"]);
  assert.equal(r.code, 0);
  const { height } = mascotCanvasSize(SPLASH_CONFIG.text);
  const expectedFrames = 1 + 2 * frameCount(SPLASH_CONFIG);
  // The trailing SHOW_CURSOR write has no newline of its own, so it rides
  // along on the last frame row's line - strip it before counting rows.
  const content = r.stdout.endsWith(SHOW) ? r.stdout.slice(0, -SHOW.length) : r.stdout;
  const rows = content.split("\n").filter(Boolean);
  assert.equal(rows.length, height * expectedFrames);
  assert.ok(new Set(rows).size > height, "expected real frame-to-frame variety, not the same frame repeated");
});
