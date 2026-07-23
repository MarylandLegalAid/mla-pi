#!/usr/bin/env node
// Dev-only contact-sheet generator. NEVER on the runtime path - the shipped
// renderer (scripts/splash/figlet-format.mjs) is a zero-dependency .flf
// parser, because scripts/validate.mjs forbids npm runtime dependencies and
// install.sh never runs `npm install` inside this repo on a staff machine.
//
// This script exists only so a human can pick a font once, at dev time, from
// a real `figlet` install:
//
//   npm install figlet --no-save   (gitignored, never touches package.json)
//   node scripts/splash-fonts.mjs > /tmp/contact-sheet.txt
//   npm uninstall figlet           (or just `rm -rf node_modules` after)
//
// Filters to fonts our reduced-scope layout engine (full-width / kern only,
// no ink-pixel smushing) can render at parity with real figlet: chunky
// (height >= 6) and smush-free by design (oldLayout <= 0, and if present,
// fullLayout has no horizontal-smushing bit set).

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const TEXT = process.argv[2] ?? "pi4MLA";
const MIN_HEIGHT = 6;
const HORIZONTAL_SMUSHING_BIT = 128;

async function loadFiglet() {
  try {
    return (await import("figlet")).default ?? (await import("figlet"));
  } catch {
    console.error(
      [
        "figlet is not installed. This is a dev-only tool - install it ad hoc, never as a project dependency:",
        "",
        "  npm install figlet --no-save",
        "  node scripts/splash-fonts.mjs",
        "  rm -rf node_modules   # clean up afterward",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }
}

function fontsDir(figletModule) {
  // figlet exposes fontsDirectory in modern versions; fall back to the
  // package's own node_modules/figlet/fonts if not present.
  if (typeof figletModule.fontsDirectory === "function" && figletModule.fontsDirectory()) {
    return figletModule.fontsDirectory();
  }
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "node_modules", "figlet", "fonts");
}

/** Header fields we need, without pulling in figlet's own parser. */
function readFontMeta(flfPath) {
  const text = readFileSync(flfPath, "utf8");
  const headerLine = text.split(/\r?\n/, 1)[0];
  const m = headerLine.match(/^flf2.(.)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)(?:\s+(-?\d+)\s+(-?\d+))?/);
  if (!m) return null;
  const [, , heightStr, , , oldLayoutStr, , fullLayoutStr] = m;
  return { height: Number(heightStr), oldLayout: Number(oldLayoutStr), fullLayout: fullLayoutStr === undefined ? undefined : Number(fullLayoutStr) };
}

function isCandidate(meta) {
  if (!meta || !Number.isFinite(meta.height)) return false;
  if (meta.height < MIN_HEIGHT) return false;
  if (meta.oldLayout > 0) return false;
  if (Number.isFinite(meta.fullLayout) && (meta.fullLayout & HORIZONTAL_SMUSHING_BIT) !== 0) return false;
  return true;
}

async function main() {
  const figlet = await loadFiglet();
  const dir = fontsDir(figlet);
  const names = readdirSync(dir)
    .filter((f) => f.endsWith(".flf"))
    .map((f) => f.slice(0, -4));

  const candidates = [];
  for (const name of names) {
    const meta = readFontMeta(join(dir, `${name}.flf`));
    if (isCandidate(meta)) candidates.push({ name, meta });
  }
  candidates.sort((a, b) => a.name.localeCompare(b.name));

  console.error(
    `${candidates.length} of ${names.length} bundled fonts pass the filter (height>=${MIN_HEIGHT}, smush-free) out of ${names.length} total.`,
  );

  const results = [];
  for (const { name, meta } of candidates) {
    try {
      const rendered = await new Promise((resolve, reject) =>
        figlet.text(TEXT, { font: name }, (err, data) => (err ? reject(err) : resolve(data))),
      );
      results.push({ name, meta, rendered });
    } catch (e) {
      console.error(`skip ${name}: ${e.message}`);
    }
  }

  const outFile = process.argv[3];
  if (outFile) {
    writeFileSync(outFile, JSON.stringify(results, null, 2));
    console.error(`wrote ${results.length} renders to ${outFile}`);
  } else {
    for (const { name, meta, rendered } of results) {
      console.log(`\n=== ${name} (oldLayout=${meta.oldLayout}${meta.fullLayout !== undefined ? `, fullLayout=${meta.fullLayout}` : ""}) ===`);
      console.log(rendered);
    }
  }
}

main();
