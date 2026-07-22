#!/usr/bin/env node
// Answers one question: is mla-pi actually set up on this machine?
//
//   node scripts/doctor.mjs
//
// Every check reports what it found, not what it assumes, and every failure comes
// with the command that fixes it. Exits non-zero if anything is broken, so it can
// gate a script.
//
// Zero dependencies, same as the other scripts here.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const results = [];
const pass = (label, detail) => results.push({ level: "ok", label, detail });
const warn = (label, detail, fix) => results.push({ level: "warn", label, detail, fix });
const bad = (label, detail, fix) => results.push({ level: "fail", label, detail, fix });

const readJson = (p) => {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
};

// pi resolves its config dir the same way pi-web-access does.
const agentDir =
  process.env.PI_CODING_AGENT_DIR ??
  (process.env.XDG_CONFIG_HOME ? join(process.env.XDG_CONFIG_HOME, "pi") : join(homedir(), ".pi"));
const settingsPath = join(agentDir, "agent", "settings.json");
const authPath = join(agentDir, "agent", "auth.json");

// ------------------------------------------------------------------ 1. pi
let piVersion = null;
try {
  piVersion = execFileSync("pi", ["--version"], { encoding: "utf8", timeout: 15_000 }).trim();
  pass("pi on PATH", piVersion);
} catch {
  bad("pi on PATH", "not found", "install pi: https://pi.dev");
}

// --------------------------------------------------------- 2. companion packages
const settings = readJson(settingsPath) ?? {};
const packages = Array.isArray(settings.packages) ? settings.packages : [];
const REQUIRED = {
  "pi-subagents": "subagent delegation",
  "@juicesharp/rpiv-ask-user-question": "structured questions",
  "pi-web-access": "web research",
};

for (const [name, why] of Object.entries(REQUIRED)) {
  if (packages.some((p) => typeof p === "string" && p.includes(name))) {
    pass(`package ${name}`, why);
  } else {
    const hard = name !== "pi-web-access";
    (hard ? bad : warn)(
      `package ${name}`,
      `missing - ${why} unavailable`,
      `bash scripts/bootstrap.sh   (or: pi install npm:${name})`,
    );
  }
}

const selfInstalled = packages.some((p) => typeof p === "string" && p.includes("mla-pi"));
if (selfInstalled) pass("mla-pi registered", "present in settings.packages");
else
  warn(
    "mla-pi registered",
    "not in settings.packages - running from a clone?",
    "pi install git:github.com/<MLA-ORG>/mla-pi",
  );

// ------------------------------------------------------------------ 3. agents
const agentsDir = join(ROOT, "agents");
const agentFiles = existsSync(agentsDir)
  ? readdirSync(agentsDir).filter((f) => f.endsWith(".md"))
  : [];
if (agentFiles.length) pass("agent definitions", `${agentFiles.length} in ${agentsDir}`);
else bad("agent definitions", `none found in ${agentsDir}`, "re-install the package");

// pi-subagents only registers package agents as `<package>.<name>`.
const manifest = readJson(join(ROOT, "package.json")) ?? {};
if (JSON.stringify(manifest["pi-subagents"]?.agents) === JSON.stringify(["./agents"])) {
  pass("agents declared", '"pi-subagents".agents = ["./agents"]');
} else {
  bad(
    "agents declared",
    "package.json is missing the pi-subagents.agents key",
    "the mla- agents will not load; restore the key",
  );
}

// ------------------------------------------------------------------ 4. models
const cfg = readJson(join(ROOT, "config", "models.json"));
const roles = cfg?.roles ?? {};
const modelOf = (r) => (typeof roles[r] === "string" ? roles[r] : roles[r]?.model);

let catalog = null;
try {
  const out = execFileSync("pi", ["--list-models"], { encoding: "utf8", timeout: 30_000 });
  catalog = new Set();
  for (const line of out.split("\n").slice(1)) {
    const [p, m] = line.trim().split(/\s+/);
    if (p && m) catalog.add(`${p}/${m}`);
  }
  if (!catalog.size) catalog = null;
} catch {
  catalog = null;
}

if (!catalog) {
  warn("model catalog", "`pi --list-models` unavailable - skipping model checks", "authenticate a provider");
} else {
  const unresolved = Object.keys(roles).filter((r) => !catalog.has(modelOf(r)));
  if (!unresolved.length) {
    pass("role models", `all ${Object.keys(roles).length} resolve against this catalog`);
  } else {
    bad(
      "role models",
      `${unresolved.length} of ${Object.keys(roles).length} not in this catalog: ${unresolved.join(", ")}`,
      "node scripts/suggest-models.mjs",
    );
  }

  // The check nothing else makes: what worker and reviewer resolve to *after*
  // fallback. A config that passes validate.mjs still collapses here.
  const sessionModel = settings.defaultProvider && settings.defaultModel
    ? `${settings.defaultProvider}/${settings.defaultModel}`
    : null;
  const resolve = (r) => (catalog.has(modelOf(r)) ? modelOf(r) : sessionModel);
  const w = resolve("worker");
  const rv = resolve("reviewer");
  if (w && rv && w === rv) {
    bad(
      "reviewer is a second opinion",
      `worker and reviewer both resolve to ${w}`,
      "node scripts/suggest-models.mjs   (build gates on this and will stop)",
    );
  } else if (w && rv) {
    pass("reviewer is a second opinion", `worker ${w} vs reviewer ${rv}`);
  }
}

// ------------------------------------------------------------- 5. OpenRouter auth
const auth = readJson(authPath) ?? {};
const hasOpenRouterKey =
  Boolean(process.env.OPENROUTER_API_KEY) || Boolean(auth.openrouter?.key);
if (hasOpenRouterKey) {
  pass("OpenRouter auth", auth.openrouter ? "key in auth.json" : "OPENROUTER_API_KEY set");
} else {
  bad(
    "OpenRouter auth",
    "no OpenRouter key found (env var or auth.json)",
    "export OPENROUTER_API_KEY=...   (or: pi login openrouter). See docs/admin.md.",
  );
}

// ------------------------------------------------------------- 6. session model
// The one role with no agent override: it sets pi's own default model.
const sessionRoleModel = modelOf("session");
if (sessionRoleModel) {
  const [wantProvider, ...wantRest] = sessionRoleModel.split("/");
  const wantModel = wantRest.join("/");
  const applied = settings.defaultProvider === wantProvider && settings.defaultModel === wantModel;
  if (applied) {
    pass("session model applied", `${settings.defaultProvider}/${settings.defaultModel}`);
  } else {
    warn(
      "session model applied",
      `defaultProvider/defaultModel is ${settings.defaultProvider ?? "(unset)"}/${settings.defaultModel ?? "(unset)"}, config wants ${sessionRoleModel}`,
      "node scripts/apply-models.mjs",
    );
  }
}

// ------------------------------------------------------------- 7. routing applied
const overrides = settings.subagents?.agentOverrides ?? {};
const agentRoles = Object.keys(roles).filter((r) => r !== "session");
const routed = agentRoles.filter((r) => overrides[`mla-${r}`] || overrides[r]);
if (!agentRoles.length) {
  // Nothing to check.
} else if (!routed.length) {
  warn(
    "model routing applied",
    "no agentOverrides in settings - every agent inherits the session model",
    "node scripts/apply-models.mjs",
  );
} else {
  pass("model routing applied", `${routed.length} of ${agentRoles.length} roles pinned`);
}

// ------------------------------------------------------------- 8. search curator
const webSearchPath = join(agentDir, "web-search.json");
const web = readJson(webSearchPath);
if (!web) {
  warn(
    "search curator",
    "no web-search.json - web_search opens the browser curator by default",
    "bash scripts/bootstrap.sh   (sets workflow: none)",
  );
} else {
  pass("search curator", `workflow: ${web.workflow ?? "(unset - defaults to summary-review)"}`);
}

// ------------------------------------------------------------------ 9. git identity
let gitName = "";
let gitEmail = "";
try {
  gitName = execFileSync("git", ["config", "--global", "user.name"], { encoding: "utf8", timeout: 5_000 }).trim();
} catch {
  /* unset */
}
try {
  gitEmail = execFileSync("git", ["config", "--global", "user.email"], { encoding: "utf8", timeout: 5_000 }).trim();
} catch {
  /* unset */
}
if (gitName && gitEmail) {
  pass("git identity", `${gitName} <${gitEmail}>`);
} else {
  bad(
    "git identity",
    "user.name and/or user.email not set globally",
    'git config --global user.name "Your Name" && git config --global user.email "you@example.org"',
  );
}

// -------------------------------------------------------------------- 10. gh auth
try {
  execFileSync("gh", ["auth", "status"], { encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] });
  pass("gh auth", "authenticated");
} catch (e) {
  const missing = e.code === "ENOENT";
  bad("gh auth", missing ? "gh not on PATH" : "not authenticated", "gh auth login");
}

// --------------------------------------------------------- 11. routing freshness
try {
  const out = execFileSync("node", [join(ROOT, "scripts", "check-routing-fresh.mjs")], {
    encoding: "utf8",
    timeout: 10_000,
  }).trim();
  if (out.startsWith("stale")) {
    warn("routing freshness", out, `pi update git:github.com/<MLA-ORG>/mla-pi && node ${join(ROOT, "scripts", "apply-models.mjs")}`);
  } else {
    pass("routing freshness", out || "up to date");
  }
} catch {
  warn("routing freshness", "check-routing-fresh.mjs failed to run", "ignore if offline");
}

// ------------------------------------------------------------------- report
const icon = { ok: "ok  ", warn: "warn", fail: "FAIL" };
console.log("");
for (const r of results) {
  console.log(`  ${icon[r.level]}  ${r.label.padEnd(32)} ${r.detail}`);
  if (r.fix) console.log(`        ${" ".repeat(32)} -> ${r.fix}`);
}

const failures = results.filter((r) => r.level === "fail").length;
const warnings = results.filter((r) => r.level === "warn").length;
console.log(
  `\n${failures} failure(s), ${warnings} warning(s), ` +
    `${results.filter((r) => r.level === "ok").length} ok\n`,
);
process.exit(failures ? 1 : 0);
