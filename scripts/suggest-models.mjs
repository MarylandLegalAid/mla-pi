#!/usr/bin/env node
// Proposes a role -> model mapping from the models this machine actually has.
//
//   node scripts/suggest-models.mjs            # print a proposal, write nothing
//   node scripts/suggest-models.mjs --write    # apply it to config/models.json
//   node scripts/suggest-models.mjs --provider openrouter
//
// config/models.json ships pinned to OpenRouter, open-weight models only. On any
// other provider every role falls back to the session model, which collapses
// worker and reviewer onto the same model and quietly turns review into
// self-review. This exists to make that a two-second fix rather than a
// hand-edit of five ids.
//
// Zero dependencies, same as the other scripts here.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const WRITE = args.includes("--write");
const providerIdx = args.indexOf("--provider");
const WANT_PROVIDER = providerIdx !== -1 ? args[providerIdx + 1] : null;

const log = (...a) => console.log(...a);
const fail = (m) => {
  console.error(`suggest-models: ${m}`);
  process.exit(1);
};

// Org prefixes with genuinely open-licensed weights, as seen on OpenRouter.
// Deliberately excludes gray areas (mistralai mixes open small models with
// closed Large/Medium tiers; baidu and ai21 are mostly closed or restrictively
// licensed) - see docs/admin.md to change this list.
const OPEN_WEIGHT_PREFIXES = [
  "deepseek", "qwen", "moonshotai", "z-ai", "meta-llama", "minimax", "nvidia",
  "microsoft", "allenai", "xiaomi", "tencent", "ibm-granite", "inclusionai",
];

// ---------------------------------------------------------------- the catalog
let catalog;
try {
  const out = execFileSync("pi", ["--list-models"], { encoding: "utf8", timeout: 30_000 });
  catalog = [];
  for (const line of out.split("\n").slice(1)) {
    const [provider, model] = line.trim().split(/\s+/);
    if (provider && model) catalog.push({ provider, model, id: `${provider}/${model}` });
  }
} catch {
  fail("could not run `pi --list-models`. Is pi on PATH and a provider authenticated?");
}
if (!catalog.length) fail("`pi --list-models` returned nothing. Authenticate a provider first.");

const providers = [...new Set(catalog.map((m) => m.provider))];
const provider = WANT_PROVIDER ?? (providers.includes("openrouter") ? "openrouter" : providers[0]);
if (!providers.includes(provider)) {
  fail(`no models for provider "${provider}". Available: ${providers.join(", ")}`);
}

let available = catalog.filter((m) => m.provider === provider);
if (provider === "openrouter") {
  const openWeight = available.filter((m) => OPEN_WEIGHT_PREFIXES.some((p) => m.model.startsWith(`${p}/`)));
  if (openWeight.length >= 2) {
    available = openWeight;
  } else {
    log(
      "warning: fewer than 2 open-weight models found on openrouter; falling back to the\n" +
        "  full openrouter catalog for this proposal. Review it against the open-weight\n" +
        "  policy in docs/admin.md before applying.",
    );
  }
} else {
  log(
    `warning: provider "${provider}" is not openrouter. mla-pi's policy is open-weight\n` +
      "  models via OpenRouter only - this proposal is a recovery step for a broken\n" +
      "  machine, not a policy-compliant routing. Authenticate OpenRouter and re-run\n" +
      "  without --provider once you can.",
  );
}

// A model's "family" is its first token, splitting on any of - _ . /. For
// OpenRouter ids (after stripping the leading provider segment) that is the
// lab/org - deepseek, qwen, z-ai - which is exactly the signal that matters for
// "is this reviewer a genuine second opinion".
const family = (model) => model.split(/[-_.\/]/)[0].toLowerCase();

// ------------------------------------------------------------- current config
const cfgPath = join(ROOT, "config", "models.json");
if (!existsSync(cfgPath)) fail(`missing ${cfgPath}`);
let cfg;
try {
  cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
} catch (e) {
  fail(`config/models.json is not valid JSON: ${e.message}`);
}

const known = new Set(catalog.map((m) => m.id));
const roles = Object.keys(cfg.roles ?? {});
if (!roles.length) fail("config/models.json has no roles");

// ------------------------------------------------------------- the assignment
// No cleverness about which model suits which role - that judgement needs a human
// who knows what these models cost and how they behave. What this guarantees is
// the mechanical property nothing else checks: worker and reviewer differ, by
// family where the catalog allows it.
const ordered = [...available].sort((a, b) => a.model.localeCompare(b.model));
const proposal = {};
const kept = [];

for (const role of roles) {
  const current = cfg.roles[role]?.model;
  if (current && known.has(current)) {
    proposal[role] = current;
    kept.push(role);
  }
}

const pick = (exclude = []) =>
  ordered.find((m) => !exclude.includes(m.id))?.id ?? ordered[0]?.id ?? null;

for (const role of roles) {
  if (proposal[role]) continue;
  proposal[role] = pick(Object.values(proposal));
}

// Enforce the one rule that matters, after everything else is assigned.
if (proposal.worker && proposal.reviewer && proposal.worker === proposal.reviewer) {
  const workerFamily = family(proposal.worker.split("/").slice(1).join("/"));
  const differentFamily = ordered.find(
    (m) => m.id !== proposal.worker && family(m.model) !== workerFamily,
  );
  const differentModel = ordered.find((m) => m.id !== proposal.worker);
  proposal.reviewer = differentFamily?.id ?? differentModel?.id ?? proposal.reviewer;
}

const collapsed = proposal.worker && proposal.worker === proposal.reviewer;

// ------------------------------------------------------------------- report
log(`provider:  ${provider}${WANT_PROVIDER ? "" : `  (${providers.includes("openrouter") ? "openrouter preferred" : `first of: ${providers.join(", ")}`})`}`);
log(`catalog:   ${available.length} model(s)\n`);

for (const role of roles) {
  const current = cfg.roles[role]?.model ?? "(unset)";
  const next = proposal[role];
  const mark = kept.includes(role) ? "keep " : "change";
  log(`  ${mark} ${role.padEnd(11)} ${next}${kept.includes(role) ? "" : `   was ${current}`}`);
}

if (collapsed) {
  log(
    `\nERROR: this catalog has only one usable model, so worker and reviewer cannot differ.\n` +
      `  A reviewer on the worker's model is self-review. Authenticate a second\n` +
      `  provider, or accept that build's review gate is not a second opinion.`,
  );
  process.exit(1);
}

if (family(proposal.worker.split("/").slice(1).join("/")) === family(proposal.reviewer.split("/").slice(1).join("/"))) {
  log(
    `\nnote: worker and reviewer are different models but the same family.\n` +
      `      Better than nothing; a different family is a better second opinion.`,
  );
}

if (!WRITE) {
  log(`\n--write applies this to config/models.json (a backup is written first).`);
  process.exit(0);
}

// --------------------------------------------------------------------- write
const next = structuredClone(cfg);
next.provider = provider;
for (const role of roles) {
  if (kept.includes(role)) continue;
  next.roles[role].model = proposal[role];
  // The old `why` described a model that is no longer here. Replacing it with an
  // honest note beats leaving a justification for something else entirely.
  next.roles[role].why = `Auto-selected by scripts/suggest-models.mjs from the ${provider} catalog. Review this - it guarantees only that worker and reviewer differ.`;
}

const backup = `${cfgPath}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
writeFileSync(backup, readFileSync(cfgPath));
writeFileSync(cfgPath, `${JSON.stringify(next, null, 2)}\n`);
log(`\nbacked up  ${backup}`);
log(`wrote      ${cfgPath}`);
log(`\nNow apply the routing:  node scripts/apply-models.mjs`);
