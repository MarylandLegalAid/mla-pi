#!/usr/bin/env node
// Structural validation for the mla-pi package. Zero dependencies.
//
//   node scripts/validate.mjs [--verbose]
//
// Exits non-zero with a precise message on the first class of failure found.

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const VERBOSE = process.argv.includes("--verbose");

const errors = [];
const warnings = [];
// Paths inside the repo read better relative; a --shards directory is usually
// outside it, where a relative path is a wall of "../".
const show = (file) => {
  const rel = relative(ROOT, file);
  return !rel || rel.startsWith("..") ? file : rel;
};
const err = (file, msg) => errors.push(`${show(file)}: ${msg}`);
const warn = (file, msg) => warnings.push(`${show(file)}: ${msg}`);
const ok = (msg) => VERBOSE && console.log(`  ok  ${msg}`);

const read = (p) => readFileSync(p, "utf8");
const walk = (dir, out = []) => {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};

// ---------------------------------------------------------------- frontmatter
// Minimal front-matter reader: `key: value`, plus `key:` followed by `- item`
// lines. Sufficient for skill and agent headers, which are deliberately flat.
function frontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const out = {};
  let listKey = null;
  for (const raw of m[1].split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const item = line.match(/^\s*-\s+(.*)$/);
    if (item && listKey) {
      out[listKey].push(stripQuotes(item[1]));
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, value] = kv;
    if (value === "") {
      listKey = key;
      out[key] = [];
    } else {
      listKey = null;
      out[key] = stripQuotes(value);
    }
  }
  return out;
}

const stripQuotes = (s) => s.replace(/^["'](.*)["']$/, "$1").trim();

// ------------------------------------------------------------- 1. package.json
const pkgPath = join(ROOT, "package.json");
let pkg = {};
try {
  pkg = JSON.parse(read(pkgPath));
  ok("package.json parses");
} catch (e) {
  err(pkgPath, `not valid JSON: ${e.message}`);
}

if (!(pkg.keywords ?? []).includes("pi-package")) {
  err(pkgPath, 'keywords must include "pi-package" for pi to discover this package');
}
if (JSON.stringify(pkg.pi?.skills) !== JSON.stringify(["./skills"])) {
  err(pkgPath, 'pi.skills must be ["./skills"]');
}
if (JSON.stringify(pkg.pi?.extensions) !== JSON.stringify(["./extensions"])) {
  err(pkgPath, 'pi.extensions must be ["./extensions"] for the startup splash to load');
}
if (JSON.stringify(pkg["pi-subagents"]?.agents) !== JSON.stringify(["./agents"])) {
  err(pkgPath, '"pi-subagents".agents must be ["./agents"] for the mla- agents to load');
}
if (pkg.dependencies && Object.keys(pkg.dependencies).length) {
  err(pkgPath, "no npm dependencies allowed: scripts must run on stock Node");
}
for (const p of [...(pkg.pi?.skills ?? []), ...(pkg.pi?.extensions ?? []), ...(pkg["pi-subagents"]?.agents ?? [])]) {
  if (!existsSync(join(ROOT, p))) err(pkgPath, `declared path does not exist: ${p}`);
}

// ------------------------------------------------------------------ 2. skills
const SKILLS = ["setup", "plan", "build", "yeet"];
const skillsDir = join(ROOT, "skills");

for (const name of SKILLS) {
  const file = join(skillsDir, name, "SKILL.md");
  if (!existsSync(file)) {
    err(file, "missing");
    continue;
  }
  const fm = frontmatter(read(file));
  if (!fm) {
    err(file, "missing YAML frontmatter");
    continue;
  }
  if (fm.name !== name) err(file, `frontmatter name "${fm.name}" must match directory "${name}"`);
  if (!/^[a-z0-9-]{1,64}$/.test(fm.name ?? "")) err(file, "name must be lowercase, <=64 chars");
  if (!fm.description) err(file, "description is required");
  else if (fm.description.length < 60) {
    err(file, "description must say what the skill does AND when to use it");
  }
  ok(`skill ${name}`);
}

if (existsSync(skillsDir)) {
  for (const d of readdirSync(skillsDir, { withFileTypes: true })) {
    if (d.isDirectory() && !SKILLS.includes(d.name)) warn(skillsDir, `unexpected skill: ${d.name}`);
  }
}

// ------------------------------------------------------------------ 3. agents
const agentsDir = join(ROOT, "agents");
const agentFiles = walk(agentsDir).filter((f) => f.endsWith(".md"));
const agentNames = new Set();

if (!agentFiles.length) err(agentsDir, "no agent definitions found");

for (const file of agentFiles) {
  const fm = frontmatter(read(file));
  if (!fm) {
    err(file, "missing YAML frontmatter");
    continue;
  }
  if (!fm.name) err(file, "name is required");
  if (fm.package !== "mla-pi") err(file, 'package must be "mla-pi" to namespace the agent');
  if (!fm.description) err(file, "description is required");
  if (!fm.tools) err(file, "tools is required: agents must declare an explicit tool set");
  if (agentNames.has(fm.name)) err(file, `duplicate agent name: ${fm.name}`);
  agentNames.add(fm.name);

  // Read-only agents must not carry write tools.
  const READ_ONLY = ["mla-scout", "mla-reviewer", "mla-researcher"];
  if (READ_ONLY.includes(fm.name) && /\b(edit|write)\b/.test(fm.tools)) {
    err(file, `${fm.name} is a read-only agent but declares edit/write in tools`);
  }
  ok(`agent ${fm.name}`);
}

// ------------------------------------------------------------------ 4. models
const modelsPath = join(ROOT, "config", "models.json");
let models = {};
try {
  models = JSON.parse(read(modelsPath));
  ok("config/models.json parses");
} catch (e) {
  err(modelsPath, `not valid JSON: ${e.message}`);
}

const roles = models.roles ?? {};
// "session" sets pi's own default model rather than an agent override - see
// scripts/apply-models.mjs - so it has no matching agent file, unlike the rest.
const REQUIRED_ROLES = ["session", "scout", "researcher", "worker", "reviewer"];
for (const role of REQUIRED_ROLES) {
  if (!roles[role]) err(modelsPath, `missing role: ${role}`);
}

for (const [role, spec] of Object.entries(roles)) {
  const model = typeof spec === "string" ? spec : spec?.model;
  if (!model) {
    err(modelsPath, `role ${role} has no model`);
    continue;
  }
  // provider/id, where id may itself contain slashes (OpenRouter: provider/org/model).
  if (!/^[a-z0-9-]+(?:\/[a-zA-Z0-9._-]+){1,}$/.test(model)) {
    err(modelsPath, `role ${role}: "${model}" is not a provider/model id`);
  }
}

if (roles.reviewer && roles.worker) {
  const r = typeof roles.reviewer === "string" ? roles.reviewer : roles.reviewer.model;
  const w = typeof roles.worker === "string" ? roles.worker : roles.worker.model;
  if (r === w) {
    err(modelsPath, "roles.reviewer must differ from roles.worker: same model is not a second opinion");
  }
}

// Open-weight default (AGENTS.md): a warning, not a hard failure, since a
// closed model is allowed when it earns its premium, and new open-weight labs
// appear over time so this list cannot be exhaustive - but an *unnoticed*
// closed-model provider slipping in here is exactly what this catches.
const OPEN_WEIGHT_PREFIXES = [
  "deepseek", "qwen", "moonshotai", "z-ai", "meta-llama", "minimax", "nvidia",
  "microsoft", "allenai", "xiaomi", "tencent", "ibm-granite", "inclusionai",
];
for (const [role, spec] of Object.entries(roles)) {
  const model = typeof spec === "string" ? spec : spec?.model;
  if (!model) continue;
  const org = model.split("/")[1]; // model is "provider/org/name" for OpenRouter
  if (org && !OPEN_WEIGHT_PREFIXES.includes(org)) {
    warn(modelsPath, `role ${role}: "${model}" is not on the known open-weight org list - confirm its license before keeping it (see docs/admin.md)`);
  }
}

// Every mla- agent needs a matching role, and vice versa. "session" is the one
// role with no agent - it sets pi's own default model, not an agent override.
for (const name of agentNames) {
  const role = name.replace(/^mla-/, "");
  if (!roles[role]) err(modelsPath, `agent ${name} has no matching role in config/models.json`);
}
for (const role of Object.keys(roles)) {
  if (role !== "session" && !agentNames.has(`mla-${role}`)) {
    err(modelsPath, `role ${role} has no matching agent (expected agents/mla-${role}.md)`);
  }
}

// Optional: check against the live catalog when pi is available.
try {
  const out = execFileSync("pi", ["--list-models"], { encoding: "utf8", timeout: 30_000 });
  const known = new Set();
  for (const line of out.split("\n").slice(1)) {
    const [provider, model] = line.trim().split(/\s+/);
    if (provider && model) known.add(`${provider}/${model}`);
  }
  if (known.size) {
    for (const [role, spec] of Object.entries(roles)) {
      const model = typeof spec === "string" ? spec : spec?.model;
      if (model && !known.has(model)) warn(modelsPath, `role ${role}: "${model}" is not in the local catalog`);
    }
    ok("model ids checked against the local catalog");
  }
} catch {
  ok("pi not available; skipped live model catalog check");
}

// ------------------------------------------------------------------ 5. limits
const limitsPath = join(ROOT, "config", "limits.json");
try {
  const limits = JSON.parse(read(limitsPath));
  const shape = {
    maxParallel: "number",
    packageTimeoutMin: "number",
    maxRetriesPerPackage: "number",
    softBudgetUsd: "number",
    softBudgetAction: "string",
  };
  for (const [key, type] of Object.entries(shape)) {
    if (typeof limits[key] !== type) err(limitsPath, `${key} must be a ${type}`);
  }
  if (typeof limits.turnBudget?.maxTurns !== "number") err(limitsPath, "turnBudget.maxTurns must be a number");
  if (typeof limits.toolBudget?.hard !== "number") err(limitsPath, "toolBudget.hard must be a number");
  ok("config/limits.json");
} catch (e) {
  if (e instanceof SyntaxError) err(limitsPath, `not valid JSON: ${e.message}`);
  else if (!existsSync(limitsPath)) err(limitsPath, "missing");
}

// ----------------------------------------------------------------- 6. catalog
// Distro families /skill:plan can resolve an install command for. Adding one here
// makes every family-bound catalog entry fail until it carries a command for it -
// which is the point: the failure is the reminder.
const FAMILIES = ["debian", "fedora", "arch"];

// Package managers, mapped to the family whose machines actually have them.
// `snap` is here because it ships on Ubuntu and essentially nowhere else by
// default, so a snap install is a debian-family install in practice.
const PKG_MANAGERS = [
  [/\b(apt|apt-get|dpkg|snap)\b/, "debian"],
  [/\b(dnf|dnf5|yum|rpm)\b/, "fedora"],
  [/\b(pacman|yay|paru)\b/, "arch"],
];

const inferFamily = (cmd) => PKG_MANAGERS.find(([re]) => re.test(cmd))?.[1] ?? null;

const catalogPath = join(ROOT, "catalog", "tools.yaml");
if (!existsSync(catalogPath)) {
  err(catalogPath, "missing");
} else {
  const entries = parseToolCatalog(read(catalogPath), catalogPath);
  const seen = new Set();
  for (const { fields, line } of entries) {
    const at = `${catalogPath}:${line}`;
    const id = fields.id;
    for (const req of ["id", "name", "kind", "detect", "install", "sudo", "scope", "domains"]) {
      if (!(req in fields)) errors.push(`${relative(ROOT, catalogPath)}:${line}: entry "${id ?? "?"}" missing ${req}`);
    }
    if (id && seen.has(id)) errors.push(`${relative(ROOT, catalogPath)}:${line}: duplicate id "${id}"`);
    if (id) seen.add(id);

    if (fields.scope && !["global", "project"].includes(fields.scope)) {
      errors.push(`${relative(ROOT, catalogPath)}:${line}: scope must be global or project`);
    }
    if (fields.sudo && !["true", "false"].includes(fields.sudo)) {
      errors.push(`${relative(ROOT, catalogPath)}:${line}: sudo must be true or false`);
    }

    // Every install variant, base and per-family alike.
    const installs = Object.entries(fields).filter(([k]) => k === "install" || k.startsWith("install_"));
    for (const [key, cmd] of installs) {
      if (key === "install_notes" || key === "install_family") continue;
      const family = key === "install" ? null : key.slice("install_".length);
      if (family && !FAMILIES.includes(family)) {
        errors.push(
          `${relative(ROOT, catalogPath)}:${line}: "${id}" has unknown platform key "${key}"` +
            ` - supported families are ${FAMILIES.join(", ")}`,
        );
      }
      // The rule that matters: plan runs non-sudo installs directly.
      if (fields.sudo === "false" && /\bsudo\b/.test(cmd ?? "")) {
        errors.push(
          `${relative(ROOT, catalogPath)}:${line}: "${id}" declares sudo: false but ${key} uses sudo` +
            " - plan would run it directly",
        );
      }
    }

    // A base install bound to one distro family needs a command for the others,
    // or plan has nothing correct to offer there. Declared via
    // install_family, otherwise inferred from the package manager it invokes.
    const declaredFamily = fields.install_family;
    if (declaredFamily && !FAMILIES.includes(declaredFamily)) {
      errors.push(
        `${relative(ROOT, catalogPath)}:${line}: "${id}" install_family "${declaredFamily}" is not one of ${FAMILIES.join(", ")}`,
      );
    }
    const baseFamily = declaredFamily ?? inferFamily(fields.install ?? "");
    if (baseFamily && FAMILIES.includes(baseFamily)) {
      for (const other of FAMILIES.filter((f) => f !== baseFamily)) {
        if (!(`install_${other}` in fields)) {
          errors.push(
            `${relative(ROOT, catalogPath)}:${line}: "${id}" install targets the ${baseFamily} family` +
              ` but has no install_${other} - use MANUAL if there is no scriptable path`,
          );
        }
      }
    }
    if (at) ok(`catalog ${id}`);
  }
  if (entries.length < 5) err(catalogPath, "catalog looks empty; expected the seeded tool set");
}

// A deliberately small YAML reader for this file's shape: a `tools:` sequence of
// flat maps. Anything more expressive would need a real parser, and a real parser
// would need a dependency.
function parseToolCatalog(text, file) {
  const out = [];
  let current = null;
  let lineNo = 0;
  for (const raw of text.split(/\r?\n/)) {
    lineNo++;
    const line = raw.replace(/\s+$/, "");
    if (!line.trim() || /^\s*#/.test(line)) continue;
    if (/^tools:\s*$/.test(line)) continue;

    const start = line.match(/^\s*-\s+([A-Za-z0-9_-]+):\s*(.*)$/);
    if (start) {
      if (current) out.push(current);
      current = { fields: { [start[1]]: stripQuotes(start[2]) }, line: lineNo };
      continue;
    }
    const kv = line.match(/^\s+([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv && current) {
      current.fields[kv[1]] = stripQuotes(kv[2]);
      continue;
    }
    if (line.trim() && !kv && !start && current === null) {
      err(file, `line ${lineNo}: unexpected content outside a tools entry`);
    }
  }
  if (current) out.push(current);
  return out;
}

// ------------------------------------------------------- 7. cross-references
const referenced = new Set();
const mdFiles = [...walk(skillsDir), ...walk(agentsDir)].filter((f) => f.endsWith(".md"));
for (const file of mdFiles) {
  const text = read(file);
  for (const m of text.matchAll(/\b((?:shared|templates|config|catalog|scripts)\/[A-Za-z0-9._/-]+)/g)) {
    const target = m[1].replace(/[.,)]+$/, "");
    referenced.add(target);
    if (!existsSync(join(ROOT, target))) err(file, `references a path that does not exist: ${target}`);
  }
}
ok(`${referenced.size} cross-references resolved`);

// ------------------------------------------------- 8. no hardcoded model ids
// Derived from config/models.json itself (provider, plus every org segment any
// role actually uses) so this keeps working as routing changes, with a small
// defensive list of other providers a skill/agent must never name directly.
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const knownPrefixes = new Set(["opencode-go", "anthropic", "openai", "google"]);
if (models.provider) knownPrefixes.add(models.provider);
for (const spec of Object.values(roles)) {
  const model = typeof spec === "string" ? spec : spec?.model;
  if (!model) continue;
  for (const seg of model.split("/").slice(0, -1)) knownPrefixes.add(seg);
}
const modelIdRe = new RegExp(`\\b(${[...knownPrefixes].map(escapeRegex).join("|")})\\/[a-zA-Z0-9._-]+`);
for (const file of mdFiles) {
  const text = read(file);
  const hit = text.match(modelIdRe);
  if (hit) {
    err(file, `hardcoded model id "${hit[0]}": skills and agents must read config/models.json`);
  }
}
ok("no hardcoded model ids in skills or agents");

// ------------------------------------------ 8b. agents referenced by full name
// pi-subagents registers package agents ONLY as `<package>.<name>`. A bare
// `mla-worker` fails at runtime with "Unknown agent" - verified against
// pi-subagents 0.35.1 under the prior pi-workflow/pw- naming; the same
// namespacing rule applies unchanged under mla-pi/mla-.
for (const file of walk(skillsDir).filter((f) => f.endsWith(".md"))) {
  const text = read(file);
  for (const m of text.matchAll(/agent:\s*"(mla-[a-z-]+)"/g)) {
    err(file, `agent "${m[1]}" must be namespaced as "mla-pi.${m[1]}" or it will not resolve`);
  }
  for (const m of text.matchAll(/(?<!mla-pi\.)`(mla-[a-z-]+)`/g)) {
    err(file, `prose references bare agent "${m[1]}"; use mla-pi.${m[1]}`);
  }
}
ok("agent references are namespaced");

// --------------------------------------------------------------- 9. secrets
// The patterns live in shared/secret-patterns.md so yeet and this script cannot
// drift. yeet reads it as instructions; this parses the same block.
const patternsPath = join(ROOT, "shared", "secret-patterns.md");
const SECRET_PATTERNS = [];
if (!existsSync(patternsPath)) {
  err(patternsPath, "missing: yeet and validate both depend on this list");
} else {
  const block = read(patternsPath).match(/```patterns\r?\n([\s\S]*?)```/);
  if (!block) {
    err(patternsPath, "no ```patterns block found");
  } else {
    for (const line of block[1].split(/\r?\n/)) {
      if (!line.trim()) continue;
      const idx = line.indexOf(" :: ");
      if (idx === -1) {
        err(patternsPath, `line is not "<label> :: <regex>": ${line.trim()}`);
        continue;
      }
      const label = line.slice(0, idx).trim();
      const source = line.slice(idx + 4).trim();
      try {
        SECRET_PATTERNS.push([new RegExp(source), label]);
      } catch (e) {
        err(patternsPath, `"${label}" is not a valid regex: ${e.message}`);
      }
    }
  }
}
if (SECRET_PATTERNS.length) ok(`${SECRET_PATTERNS.length} secret patterns loaded`);

for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file);
  if (rel.startsWith(".git/") || rel.startsWith("node_modules/") || rel.startsWith(".pi-workflow/")) continue;
  if (statSync(file).size > 512 * 1024) continue;
  let text;
  try {
    text = read(file);
  } catch {
    continue;
  }
  for (const [re, label] of SECRET_PATTERNS) {
    if (re.test(text)) err(file, `possible ${label} committed`);
  }
}
ok("no secrets detected");

// ------------------------------------------------------------ 10. plan shards
// Opt-in: plans live in .pi-workflow/, which is gitignored and outside this repo,
// so there is nothing to check unless a directory is named.
//
//   node scripts/validate.mjs --shards <project>/.pi-workflow/plan
const shardsIdx = process.argv.indexOf("--shards");
if (shardsIdx !== -1) {
  const shardDir = process.argv[shardsIdx + 1];
  if (!shardDir) err("--shards", "needs a directory: --shards <plan-dir>");
  else if (!existsSync(shardDir)) err(shardDir, "no such directory");
  else {
    const files = readdirSync(shardDir)
      .filter((f) => f.endsWith(".md") && f !== "00-overview.md")
      .sort();
    if (!files.length) warn(shardDir, "no shards found");

    const shards = new Map();
    for (const file of files) {
      const path = join(shardDir, file);
      const fm = frontmatter(read(path));
      if (!fm) {
        err(path, "missing YAML frontmatter");
        continue;
      }
      shards.set(fm.id, { fm, path, file });

      // `<id>.md`, or `<NN>-<id>.md` - plan writes the ordering prefix into
      // the filename while the id carries its own, so both spellings are real.
      if (!fm.id) err(path, "id is required");
      else if (file !== `${fm.id}.md` && !new RegExp(`^\\d+-${fm.id}\\.md$`).test(file)) {
        err(path, `id "${fm.id}" must match the filename (expected ${fm.id}.md or NN-${fm.id}.md)`);
      }
      // A list, not a scalar: `acceptance: yes` is not a checkable criterion.
      if (!Array.isArray(fm.acceptance) || !fm.acceptance.length) {
        err(path, "acceptance is required and must be a list of checkable criteria");
      }

      const isManual = String(fm.manual) === "true";
      const isNetwork = String(fm.network) === "true";
      const owns = Array.isArray(fm.owns) ? fm.owns : [];

      // Invariant 6.
      if (isManual && owns.length) err(path, "manual: true packages must have no owns");
      if (!isManual && !owns.length) err(path, "owns is required unless manual: true");

      // Invariant 8.
      if ("timeout_min" in fm) {
        const t = Number(fm.timeout_min);
        if (!Number.isInteger(t) || t <= 0) {
          err(path, `timeout_min must be a positive integer of minutes, got "${fm.timeout_min}"`);
        }
      }

      // Invariant 7: the one that would have caught the scraper.
      if (isNetwork && !isManual && !("timeout_min" in fm)) {
        err(
          path,
          "network: true needs an explicit timeout_min (or manual: true) - the default" +
            " budget will kill it mid-run and the retry starts from a fresh context",
        );
      }

      // Invariant 3: no open questions left for the implementer.
      const body = read(path).replace(/^---[\s\S]*?---/, "");
      const open = body.match(/\b(TBD|decide whether|either\/or|to be decided)\b/i);
      if (open) err(path, `open question left in the shard: "${open[0]}"`);
    }

    // Invariant 2: depends_on names real ids and is acyclic.
    for (const [id, { fm, path }] of shards) {
      for (const dep of Array.isArray(fm.depends_on) ? fm.depends_on : []) {
        if (!shards.has(dep)) err(path, `depends_on names a shard that does not exist: ${dep}`);
      }
    }
    const state = new Map();
    const walk = (id, trail) => {
      if (state.get(id) === "done") return;
      if (state.get(id) === "open") {
        err(shardDir, `depends_on cycle: ${[...trail, id].join(" -> ")}`);
        return;
      }
      state.set(id, "open");
      for (const dep of shards.get(id)?.fm.depends_on ?? []) {
        if (shards.has(dep)) walk(dep, [...trail, id]);
      }
      state.set(id, "done");
    };
    for (const id of shards.keys()) walk(id, []);

    ok(`${shards.size} shard(s) checked`);

    // The plan dir is <project>/.pi-workflow/plan, so the project root is two up.
    // Planning artifacts and subagent transcripts must be untrackable there.
    const projectRoot = dirname(dirname(shardDir));
    const gitDir = join(projectRoot, ".git");
    if (existsSync(gitDir)) {
      for (const dir of [".pi-workflow", ".pi-subagents"]) {
        if (!existsSync(join(projectRoot, dir))) continue;
        try {
          execFileSync("git", ["-C", projectRoot, "check-ignore", "-q", dir], { stdio: "ignore" });
        } catch {
          err(join(projectRoot, ".gitignore"), `${dir}/ is not gitignored - plans and transcripts must never be committable`);
        }
      }
      // Adding a .gitignore entry does not untrack what is already in the index.
      // That distinction is the whole bug: the ignore looks right and the files
      // are still staged.
      try {
        const tracked = execFileSync(
          "git",
          ["-C", projectRoot, "ls-files", "--cached", ".pi-workflow", ".pi-subagents"],
          { encoding: "utf8" },
        )
          .split("\n")
          .filter(Boolean);
        if (tracked.length) {
          err(
            projectRoot,
            `${tracked.length} planning artifact(s) are tracked by git despite .gitignore` +
              ` - .gitignore does not untrack what is already staged.` +
              ` Fix: git -C ${projectRoot} rm -r --cached .pi-workflow .pi-subagents`,
          );
        }
      } catch {
        // Not a usable git repo; the check above already covered what it can.
      }
      ok("planning artifacts are untrackable");
    }
  }
}

// ----------------------------------------------------------------- report
if (warnings.length) {
  console.log(`\n${warnings.length} warning(s):`);
  for (const w of warnings) console.log(`  ! ${w}`);
}

if (errors.length) {
  console.error(`\n${errors.length} error(s):`);
  for (const e of errors) console.error(`  x ${e}`);
  process.exit(1);
}

console.log(`\nmla-pi: valid (${SKILLS.length} skills, ${agentNames.size} agents)`);
