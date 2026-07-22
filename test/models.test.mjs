// apply-models.mjs and suggest-models.mjs, run against fake machines.
//
// The failure these exist to prevent is silent: a config that validates cleanly
// still puts worker and reviewer on the same model when the machine's provider is
// not the one config/models.json targets. `session` is handled separately from
// the rest - see apply-models.mjs - so it gets its own coverage below.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { repoCopy, fakeBin, run, out, tmp, readJson, exists } from "./support/harness.mjs";

// Matches config/models.json's real roles exactly, in the OpenRouter
// provider/org/model shape every role there actually uses.
const REAL = [
  "openrouter/deepseek/deepseek-v4-pro",   // session
  "openrouter/deepseek/deepseek-v4-flash", // scout
  "openrouter/meta/muse-spark-1.1",        // researcher
  "openrouter/xiaomi/mimo-v2.5-pro",       // worker
  "openrouter/z-ai/glm-5.2",               // reviewer
];
const OTHER = ["anthropic/claude-opus-4-8", "anthropic/claude-sonnet-5", "anthropic/claude-haiku-4-5"];

const apply = (dir, args, binDir) =>
  run(join(dir, "scripts", "apply-models.mjs"), args, { cwd: dir, binDir });
const suggest = (dir, args, binDir) =>
  run(join(dir, "scripts", "suggest-models.mjs"), args, { cwd: dir, binDir });

// ---------------------------------------------------------------- apply-models

test("writes an override per non-session role when every model resolves", () => {
  const dir = repoCopy();
  const settings = join(tmp(), "settings.json");
  const r = apply(dir, ["--settings", settings], fakeBin({ pi: REAL }));
  assert.equal(r.code, 0, out(r));
  const written = readJson(settings);
  const overrides = written.subagents.agentOverrides;
  assert.equal(overrides["mla-worker"].model, "openrouter/xiaomi/mimo-v2.5-pro");
  assert.equal(overrides["mla-reviewer"].model, "openrouter/z-ai/glm-5.2");
  // Both name forms, so routing lands whichever pi-subagents accepts.
  assert.ok(overrides["mla-pi.mla-worker"], "namespaced form missing");
  // session is not an agent - it must never appear as an override.
  assert.ok(!overrides["mla-session"], "session must not be written as an agent override");
  assert.ok(!overrides.session, "session must not be written as a bare agent override");
});

test("writes the session role into defaultProvider/defaultModel/defaultThinkingLevel", () => {
  const dir = repoCopy();
  const settings = join(tmp(), "settings.json");
  const r = apply(dir, ["--settings", settings], fakeBin({ pi: REAL }));
  assert.equal(r.code, 0, out(r));
  const written = readJson(settings);
  assert.equal(written.defaultProvider, "openrouter");
  // Bare id, provider stripped - matches how pi's own settings.json stores it.
  assert.equal(written.defaultModel, "deepseek/deepseek-v4-pro");
  assert.equal(written.defaultThinkingLevel, "high");
});

test("exits non-zero and writes nothing when no role resolves", () => {
  const dir = repoCopy();
  const settings = join(tmp(), "settings.json");
  const r = apply(dir, ["--settings", settings], fakeBin({ pi: OTHER }));
  assert.equal(r.code, 2, "zero overrides must not read as success");
  assert.match(out(r), /not one role resolved/);
  assert.equal(exists(settings), false, "settings must not be written on failure");
});

test("preserves unrelated settings keys", () => {
  const dir = repoCopy();
  const settings = join(tmp(), "settings.json");
  writeFileSync(settings, JSON.stringify({ theme: "dark", packages: ["npm:pi-subagents"] }));
  const r = apply(dir, ["--settings", settings], fakeBin({ pi: REAL }));
  assert.equal(r.code, 0, out(r));
  const after = readJson(settings);
  assert.equal(after.theme, "dark");
  assert.deepEqual(after.packages, ["npm:pi-subagents"]);
});

test("refuses to overwrite a settings file it cannot parse", () => {
  const dir = repoCopy();
  const settings = join(tmp(), "settings.json");
  writeFileSync(settings, "{ not json");
  const r = apply(dir, ["--settings", settings], fakeBin({ pi: REAL }));
  assert.equal(r.code, 1);
  assert.match(out(r), /refusing to overwrite/);
  assert.equal(readFileSync(settings, "utf8"), "{ not json");
});

test("--dry-run writes nothing", () => {
  const dir = repoCopy();
  const settings = join(tmp(), "settings.json");
  const r = apply(dir, ["--dry-run", "--settings", settings], fakeBin({ pi: REAL }));
  assert.equal(r.code, 0, out(r));
  assert.equal(exists(settings), false);
});

test("warns when only one of worker/reviewer resolves", () => {
  const dir = repoCopy();
  const settings = join(tmp(), "settings.json");
  // Everything present except the worker's model.
  const partial = REAL.filter((m) => !m.includes("mimo-v2.5-pro"));
  const r = apply(dir, ["--settings", settings], fakeBin({ pi: partial }));
  assert.equal(r.code, 0, out(r));
  assert.match(out(r), /worker did not resolve/);
});

// -------------------------------------------------------------- suggest-models

test("keeps every role when the configured models all exist", () => {
  const dir = repoCopy();
  const r = suggest(dir, [], fakeBin({ pi: REAL }));
  assert.equal(r.code, 0, out(r));
  assert.doesNotMatch(r.stdout, /change/);
  assert.match(r.stdout, /keep\s+worker/);
});

test("prefers openrouter as the default provider when present", () => {
  const dir = repoCopy();
  const r = suggest(dir, [], fakeBin({ pi: [...REAL, ...OTHER] }));
  assert.equal(r.code, 0, out(r));
  assert.match(r.stdout, /provider:\s+openrouter/);
});

test("proposes a mapping when the configured provider is absent", () => {
  const dir = repoCopy();
  const r = suggest(dir, [], fakeBin({ pi: OTHER }));
  assert.equal(r.code, 0, out(r));
  assert.match(r.stdout, /change session/);
  assert.match(r.stdout, /provider:\s+anthropic/);
  assert.match(out(r), /not openrouter/);
});

test("the proposal never puts worker and reviewer on one model", () => {
  const dir = repoCopy();
  const r = suggest(dir, [], fakeBin({ pi: OTHER }));
  const worker = r.stdout.match(/worker\s+(\S+)/)[1];
  const reviewer = r.stdout.match(/reviewer\s+(\S+)/)[1];
  assert.notEqual(worker, reviewer);
});

test("filters an openrouter catalog to open-weight models when a fresh pick is needed", () => {
  const dir = repoCopy();
  // Force scout's current model to miss the catalog so suggest-models must
  // pick something fresh for it, rather than keeping what's already there.
  const cfgPath = join(dir, "config", "models.json");
  const cfg = readJson(cfgPath);
  cfg.roles.scout.model = "openrouter/deepseek/does-not-exist";
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));

  const mixed = [...REAL, "openrouter/openai/gpt-5", "openrouter/anthropic/claude-sonnet-4"];
  const r = suggest(dir, [], fakeBin({ pi: mixed }));
  assert.equal(r.code, 0, out(r));
  assert.doesNotMatch(out(r), /fewer than 2 open-weight/);
  assert.match(r.stdout, /change scout/);
  const picked = r.stdout.match(/change scout\s+(\S+)/)[1];
  assert.ok(!picked.includes("openai") && !picked.includes("anthropic"), `scout picked a closed model: ${picked}`);
});

test("falls back to the full openrouter catalog when too few open-weight models exist", () => {
  const dir = repoCopy();
  const r = suggest(dir, [], fakeBin({ pi: ["openrouter/openai/gpt-5", "openrouter/anthropic/claude-sonnet-4"] }));
  assert.equal(r.code, 0, out(r));
  assert.match(out(r), /fewer than 2 open-weight/);
});

test("refuses outright when the catalog has one model", () => {
  const dir = repoCopy();
  const r = suggest(dir, [], fakeBin({ pi: ["ollama/llama4"] }));
  assert.equal(r.code, 1);
  assert.match(out(r), /worker and reviewer cannot differ/);
});

test("--write applies the proposal and backs the old config up", () => {
  const dir = repoCopy();
  const cfgPath = join(dir, "config", "models.json");
  const before = readJson(cfgPath);
  const r = suggest(dir, ["--write"], fakeBin({ pi: OTHER }));
  assert.equal(r.code, 0, out(r));
  const after = readJson(cfgPath);
  assert.equal(after.provider, "anthropic");
  assert.notEqual(after.roles.worker.model, before.roles.worker.model);
  assert.notEqual(after.roles.worker.model, after.roles.reviewer.model);
  assert.match(out(r), /backed up/);
  // The old `why` described a model that is no longer routed there.
  assert.match(after.roles.worker.why, /Auto-selected/);
});

test("the written config passes validate", () => {
  const dir = repoCopy();
  const bin = fakeBin({ pi: OTHER });
  assert.equal(suggest(dir, ["--write"], bin).code, 0);
  const v = run(join(dir, "scripts", "validate.mjs"), [], { cwd: dir, binDir: bin });
  assert.equal(v.code, 0, out(v));
});

test("an unknown --provider is refused with the list of real ones", () => {
  const dir = repoCopy();
  const r = suggest(dir, ["--provider", "openai"], fakeBin({ pi: OTHER }));
  assert.equal(r.code, 1);
  assert.match(out(r), /no models for provider "openai".*anthropic/s);
});

test("says what is wrong when pi is not on PATH", () => {
  const dir = repoCopy();
  const r = run(join(dir, "scripts", "suggest-models.mjs"), [], {
    cwd: dir,
    env: { PATH: "/nonexistent-for-tests" },
  });
  assert.equal(r.code, 1);
  assert.match(out(r), /could not run `pi --list-models`/);
});
