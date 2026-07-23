#!/usr/bin/env node
// Standalone terminal-owning splash renderer - the one place in this repo
// allowed to touch raw stdout/cursor control. Everything else (the pure
// FIGlet parsing and color/dither pipeline) lives in scripts/splash/ and is
// shared with scripts/session-splash.mjs's static, in-pi-header render.
//
// Usage: node scripts/splash-cli.mjs [static|pan|shimmer|preview] [--width N] [--color=auto|always|never] [--scheme=dark|light]
//
//   static   print the wordmark once, no animation
//   pan      1.2s horizontal gradient-pan animation
//   shimmer  1.2s dither-shimmer animation
//   preview  cycles static -> pan -> shimmer, back to back ("preview every effect")
//
// --scheme picks "dark" (white-ish outline, for dark terminal backgrounds) or
// "light" (black-ish outline, for light backgrounds); defaults to
// splash.config.json's defaultScheme. Neither scheme mixes white and black.
//
// Respects NO_COLOR (always wins, even over --color=always) and noninteractive
// (non-TTY) output, skips the wordmark for a one-line compact fallback under
// 90 columns, and always restores the hidden cursor - on normal completion,
// SIGINT, SIGTERM, or an uncaught exception.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFlf, layoutWord } from "./splash/figlet-format.mjs";
import { renderFrame, frameCount, phaseForTick, tickIntervalMs } from "./splash/render-core.mjs";
import { HIDE_CURSOR, SHOW_CURSOR, CLEAR_LINE, moveUp } from "./splash/ansi.mjs";

const SPLASH_DIR = join(dirname(fileURLToPath(import.meta.url)), "splash");

function loadConfig() {
  const config = JSON.parse(readFileSync(join(SPLASH_DIR, "splash.config.json"), "utf8"));
  const font = parseFlf(readFileSync(join(SPLASH_DIR, config.font.file), "utf8"));
  return { config, font };
}

function maskFor(config, font) {
  return layoutWord(font, config.text, { mode: config.font.layoutMode }).grid;
}

// ------------------------------------------------------------------- CLI args
// --debug-* flags exist only for the test suite (test/splash-cli.test.mjs),
// which has no real TTY to spawn a child process against. Real usage never
// passes them.
function parseArgs(argv) {
  const out = {
    command: "static",
    width: undefined,
    color: "auto",
    scheme: undefined,
    debugThrowAfterFrame: undefined,
    instant: false,
    forceTty: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--width") out.width = Number(argv[++i]);
    else if (a.startsWith("--width=")) out.width = Number(a.slice("--width=".length));
    else if (a === "--color") out.color = argv[++i];
    else if (a.startsWith("--color=")) out.color = a.slice("--color=".length);
    else if (a === "--scheme") out.scheme = argv[++i];
    else if (a.startsWith("--scheme=")) out.scheme = a.slice("--scheme=".length);
    else if (a.startsWith("--debug-throw-after-frame=")) out.debugThrowAfterFrame = Number(a.slice("--debug-throw-after-frame=".length));
    else if (a === "--debug-instant") out.instant = true;
    else if (a === "--debug-force-tty") out.forceTty = true;
    else if (!a.startsWith("-")) out.command = a;
  }
  return out;
}

// ------------------------------------------------------------ environment detection
function detectWidth(explicit) {
  if (Number.isFinite(explicit)) return explicit;
  return process.stdout.columns ?? 80; // unknown (piped) width defaults under minColumns - the safe, compact choice
}

function detectUnicode() {
  const loc = `${process.env.LC_ALL ?? ""} ${process.env.LC_CTYPE ?? ""} ${process.env.LANG ?? ""}`.toLowerCase();
  return loc.includes("utf-8") || loc.includes("utf8");
}

function colorModeFromEnv() {
  const colorterm = (process.env.COLORTERM ?? "").toLowerCase();
  if (colorterm.includes("truecolor") || colorterm.includes("24bit")) return "truecolor";
  const term = (process.env.TERM ?? "").toLowerCase();
  if (term.includes("256color")) return "256";
  if (term === "dumb" || term === "") return "none";
  return "truecolor";
}

/** NO_COLOR (any value, per no-color.org) always wins, even over --color=always. */
function detectColorMode(colorArg) {
  if (process.env.NO_COLOR !== undefined) return "none";
  if (colorArg === "never") return "none";
  if (colorArg === "always") return colorModeFromEnv();
  if (!process.stdout.isTTY) return "none"; // auto + noninteractive output
  return colorModeFromEnv();
}

// --------------------------------------------------------------- cursor safety
function installSignalHandlers() {
  const restore = () => process.stdout.write(SHOW_CURSOR);
  process.on("SIGINT", () => {
    restore();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    restore();
    process.exit(143);
  });
  process.on("uncaughtException", (err) => {
    restore();
    console.error(err?.stack ?? String(err));
    process.exit(1);
  });
}

// ------------------------------------------------------------------- rendering
const sleep = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

/** Move up over the previous frame (if any), then clear+rewrite every row - never scrolls. */
function writeFrame(lines, priorLineCount) {
  let out = priorLineCount > 0 ? moveUp(priorLineCount) : "";
  for (const line of lines) out += `${CLEAR_LINE}${line}\n`;
  process.stdout.write(out);
}

function printStatic({ config, font, colorMode, unicode, scheme }) {
  const lines = renderFrame(maskFor(config, font), config, { animation: "static", colorMode, unicode, scheme });
  process.stdout.write(`${lines.join("\n")}\n`);
}

function printCompactFallback(config) {
  process.stdout.write(`${config.text}\n`);
}

async function playAnimation({ config, font, animation, colorMode, unicode, scheme, debugThrowAfterFrame, instant }) {
  const grid = maskFor(config, font);
  const total = frameCount(config);
  const interval = instant ? 0 : tickIntervalMs(config);
  let priorLineCount = 0;
  process.stdout.write(HIDE_CURSOR);
  try {
    for (let tick = 0; tick < total; tick++) {
      const lines = renderFrame(grid, config, { animation, phase: phaseForTick(tick, config), colorMode, unicode, scheme });
      writeFrame(lines, priorLineCount);
      priorLineCount = lines.length;
      if (debugThrowAfterFrame !== undefined && tick === debugThrowAfterFrame) {
        throw new Error("debug throw for testing cursor restoration");
      }
      await sleep(interval);
    }
  } finally {
    process.stdout.write(SHOW_CURSOR);
  }
}

async function runPreview({ config, font, colorMode, unicode, scheme, instant }) {
  const grid = maskFor(config, font);
  const interval = instant ? 0 : tickIntervalMs(config);
  const holdMs = instant ? 0 : 500;
  let priorLineCount = 0;
  process.stdout.write(HIDE_CURSOR);
  try {
    const staticLines = renderFrame(grid, config, { animation: "static", colorMode, unicode, scheme });
    writeFrame(staticLines, priorLineCount);
    priorLineCount = staticLines.length;
    await sleep(holdMs);

    for (const animation of ["pan", "shimmer"]) {
      const total = frameCount(config);
      for (let tick = 0; tick < total; tick++) {
        const lines = renderFrame(grid, config, { animation, phase: phaseForTick(tick, config), colorMode, unicode, scheme });
        writeFrame(lines, priorLineCount);
        priorLineCount = lines.length;
        await sleep(interval);
      }
    }
  } finally {
    process.stdout.write(SHOW_CURSOR);
  }
}

// ------------------------------------------------------------------------ main
async function main() {
  installSignalHandlers();

  const args = parseArgs(process.argv.slice(2));
  const { config, font } = loadConfig();
  const width = detectWidth(args.width);
  const colorMode = detectColorMode(args.color);
  const unicode = detectUnicode();
  const interactive = process.stdout.isTTY || args.forceTty;

  if (args.scheme !== undefined && !config.schemes[args.scheme]) {
    process.stderr.write(`unknown --scheme: ${args.scheme} (expected one of: ${Object.keys(config.schemes).join(", ")})\n`);
    process.exitCode = 1;
    return;
  }
  const scheme = args.scheme;

  if (width < config.minColumns) {
    printCompactFallback(config);
    return;
  }

  // Noninteractive output (piped/redirected): never animate, never emit
  // cursor-control escapes - just the static render, in whatever color mode
  // was resolved above (still "none" unless explicitly forced).
  if (!interactive) {
    printStatic({ config, font, colorMode, unicode, scheme });
    return;
  }

  switch (args.command) {
    case "static":
      printStatic({ config, font, colorMode, unicode, scheme });
      break;
    case "pan":
    case "shimmer":
      await playAnimation({
        config,
        font,
        animation: args.command,
        colorMode,
        unicode,
        scheme,
        debugThrowAfterFrame: args.debugThrowAfterFrame,
        instant: args.instant,
      });
      break;
    case "preview":
      await runPreview({ config, font, colorMode, unicode, scheme, instant: args.instant });
      break;
    default:
      process.stderr.write(
        `unknown command: ${args.command}\nusage: splash-cli.mjs [static|pan|shimmer|preview] [--width N] [--color=auto|always|never] [--scheme=dark|light]\n`,
      );
      process.exitCode = 1;
  }
}

main();
