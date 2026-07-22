#!/usr/bin/env node
// Applies config/models.json to this machine's ~/.pi/agent/settings.json:
// the `session` role becomes pi's own default model, every other role becomes
// a pi-subagents agent override. Zero dependencies by design: `pi install` runs
// `npm install` on fresh machines, and every dependency is a way for that to fail.
//
//   node scripts/apply-models.mjs [--dry-run] [--settings <path>]

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const settingsIdx = args.indexOf("--settings");
const SETTINGS =
  settingsIdx !== -1 && args[settingsIdx + 1]
    ? args[settingsIdx + 1]
    : join(homedir(), ".pi", "agent", "settings.json");

const log = (...a) => console.log(...a);
const fail = (m) => {
  console.error(`apply-models: ${m}`);
  process.exit(1);
};

// ---------------------------------------------------------------- load config
const cfgPath = join(ROOT, "config", "models.json");
if (!existsSync(cfgPath)) fail(`missing ${cfgPath}`);

let cfg;
try {
  cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
} catch (e) {
  fail(`config/models.json is not valid JSON: ${e.message}`);
}

const roles = cfg.roles ?? {};
if (!Object.keys(roles).length) fail("config/models.json has no roles");

if (roles.reviewer?.model && roles.reviewer.model === roles.worker?.model) {
  fail(
    "roles.reviewer and roles.worker resolve to the same model.\n" +
      "  A reviewer sharing the implementer's model is not a second opinion.\n" +
      "  Edit config/models.json and re-run.",
  );
}

// ------------------------------------------------- validate against the catalog
let known = null;
try {
  const out = execFileSync("pi", ["--list-models"], { encoding: "utf8", timeout: 30_000 });
  known = new Set();
  for (const line of out.split("\n").slice(1)) {
    const [provider, model] = line.trim().split(/\s+/);
    if (provider && model) known.add(`${provider}/${model}`);
  }
  if (!known.size) known = null;
} catch {
  log("note: could not run `pi --list-models`; skipping model catalog validation");
}

// ----------------------------------------------------------- build the overrides
// `session` sets pi's own default model/provider/thinking, not a subagent
// override - it is what the interactive session and inline build work run on.
// Every other role maps to the agent mla-pi.mla-<role>.
const overrides = {};
const sessionUpdate = {};
const skipped = [];

for (const [role, spec] of Object.entries(roles)) {
  const model = typeof spec === "string" ? spec : spec?.model;
  if (!model) continue;

  if (known && !known.has(model)) {
    skipped.push(`${role} -> ${model} (not in the provider catalog)`);
    continue;
  }

  if (role === "session") {
    // model is "provider/id", where id itself may contain slashes (OpenRouter:
    // provider/org/model) - split on the first slash only.
    const slash = model.indexOf("/");
    sessionUpdate.defaultProvider = model.slice(0, slash);
    sessionUpdate.defaultModel = model.slice(slash + 1);
    if (typeof spec === "object" && spec.thinking) sessionUpdate.defaultThinkingLevel = spec.thinking;
    continue;
  }

  const entry = { model };
  if (typeof spec === "object" && spec.thinking) entry.thinking = spec.thinking;
  if (typeof spec === "object" && Array.isArray(spec.fallbackModels)) {
    entry.fallbackModels = spec.fallbackModels;
  }

  // pi-subagents resolves package agents under both the bare name and the
  // `<package>.<name>` form. Write both so the override lands either way.
  overrides[`mla-${role}`] = entry;
  overrides[`mla-pi.mla-${role}`] = entry;
}

if (skipped.length) {
  log("skipped (model missing from the catalog - the role falls back to the session model):");
  for (const s of skipped) log(`  ${s}`);
}

// Writing nothing is not success. Every role falling back to the session model
// puts worker and reviewer on the same model, and build's review gate becomes
// self-review without ever saying so.
if (known && !Object.keys(overrides).length && !Object.keys(sessionUpdate).length) {
  console.error(
    `\nERROR: not one role resolved against this machine's model catalog.\n` +
      `  config/models.json targets "${cfg.provider ?? "unknown"}" and nothing here matches,\n` +
      `  so every mla- agent would inherit whatever session model was already set -\n` +
      `  including both worker and reviewer, which makes review a second opinion in\n` +
      `  name only.\n\n` +
      `  Propose a mapping from the models you do have:\n` +
      `    node scripts/suggest-models.mjs\n`,
  );
  process.exit(2);
}

// A partial resolution can collapse the same way: whichever of the two falls back
// lands on the session model, and the other may already be it.
const criticalMissing = ["worker", "reviewer"].filter((r) => !overrides[`mla-${r}`]);
if (known && criticalMissing.length) {
  log(
    `\nwarning: ${criticalMissing.join(" and ")} did not resolve and will inherit the\n` +
      `  session model. If that is also the other role's model, review is self-review.\n` +
      `  Check with:  node scripts/doctor.mjs`,
  );
}

// ------------------------------------------------------------- merge and write
let settings = {};
if (existsSync(SETTINGS)) {
  try {
    settings = JSON.parse(readFileSync(SETTINGS, "utf8"));
  } catch (e) {
    fail(`${SETTINGS} is not valid JSON (${e.message}); refusing to overwrite it`);
  }
} else {
  log(`note: ${SETTINGS} does not exist yet; it will be created`);
}

// Merge, never replace: preserve every unrelated key.
const next = {
  ...settings,
  ...sessionUpdate,
  subagents: {
    ...(settings.subagents ?? {}),
    agentOverrides: { ...(settings.subagents?.agentOverrides ?? {}), ...overrides },
  },
};

const rendered = `${JSON.stringify(next, null, 2)}\n`;

if (DRY) {
  log("\n--dry-run: would write these agent overrides:\n");
  log(JSON.stringify(overrides, null, 2));
  if (Object.keys(sessionUpdate).length) {
    log("\n--dry-run: would set the session default model:\n");
    log(JSON.stringify(sessionUpdate, null, 2));
  }
  process.exit(0);
}

mkdirSync(dirname(SETTINGS), { recursive: true });

if (existsSync(SETTINGS)) {
  const backup = `${SETTINGS}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  writeFileSync(backup, readFileSync(SETTINGS));
  log(`backed up  ${backup}`);
}

// Atomic: a killed process must never leave a truncated settings file.
const tmp = `${SETTINGS}.tmp-${process.pid}`;
writeFileSync(tmp, rendered);
renameSync(tmp, SETTINGS);

log(`\nwrote ${Object.keys(overrides).length} agent overrides to ${SETTINGS}`);
for (const [name, entry] of Object.entries(overrides)) {
  if (!name.startsWith("mla-pi.")) log(`  ${name.padEnd(16)} ${entry.model}`);
}
if (Object.keys(sessionUpdate).length) {
  log(`  ${"session".padEnd(16)} ${sessionUpdate.defaultProvider}/${sessionUpdate.defaultModel}`);
}
log("\nRestart pi for these to take effect, then verify with:");
log("  /subagents         mla-* agents (source: package) and their models");
log("  node scripts/doctor.mjs");
