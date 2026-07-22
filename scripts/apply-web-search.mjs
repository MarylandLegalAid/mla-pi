#!/usr/bin/env node
// Defaults pi-web-access to raw search results instead of the browser curator.
//
//   node scripts/apply-web-search.mjs             # fill in workflow if absent
//   node scripts/apply-web-search.mjs --dry-run
//
// The curator only ever affects top-level searches: mla-researcher subagents have
// no UI, so pi-web-access resolves them to "none" regardless. Leaving it on gives
// interactive searches different handling from the research that actually feeds a
// plan.
//
// Only fills the key in when absent. A later `/curator on` is a deliberate choice
// and re-running bootstrap must not silently undo it.
//
// Zero dependencies, same as the other scripts here.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DRY = process.argv.includes("--dry-run");

// Resolved exactly as pi-web-access resolves it (utils.ts getWebSearchConfigDir).
export function configDir(env = process.env) {
  if (env.PI_CODING_AGENT_DIR) return env.PI_CODING_AGENT_DIR;
  if (env.XDG_CONFIG_HOME) return join(env.XDG_CONFIG_HOME, "pi");
  return join(homedir(), ".pi");
}

const dir = configDir();
const file = join(dir, "web-search.json");

let config = {};
if (existsSync(file)) {
  try {
    config = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    // Not ours to repair. Bootstrap runs under `set -e`, and aborting here would
    // strand a machine whose packages are already installed.
    console.log(`  skipped           ${file} is not valid JSON (${e.message}); leaving it alone`);
    process.exit(0);
  }
}

if ("workflow" in config) {
  console.log(`  already set       workflow: ${config.workflow}`);
  process.exit(0);
}

config.workflow = "none";

if (DRY) {
  console.log(`  --dry-run: would write workflow: none -> ${file}`);
  process.exit(0);
}

mkdirSync(dir, { recursive: true });
writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
console.log(`  wrote             workflow: none -> ${file}`);
console.log("  raw search results, no browser curator. Re-enable with /curator on");
