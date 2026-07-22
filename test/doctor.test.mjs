// doctor.mjs against fake machines, and apply-web-search.mjs against fake config
// dirs. These are the two scripts a first-time user meets before any skill runs.
//
// This machine (the one running the test suite) has a real `pi` and a real `gh`
// installed, so every test that needs "missing" must replace PATH wholesale via
// isolatedPath() - prepending a fake bin dir is only safe for "present" cases,
// since an absent stub still falls through to the real binary further down PATH.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { writeFileSync, readFileSync } from "node:fs";
import {
  repoCopy, fakeBin, isolatedPath, run, out, tmp, readJson, exists, fakeAgentDir, fakeHome,
} from "./support/harness.mjs";

const REAL = [
  "openrouter/deepseek/deepseek-v4-pro",   // session
  "openrouter/deepseek/deepseek-v4-flash", // scout
  "openrouter/meta/muse-spark-1.1",        // researcher
  "openrouter/xiaomi/mimo-v2.5-pro",       // worker
  "openrouter/z-ai/glm-5.2",               // reviewer
];
const OTHER = ["anthropic/claude-opus-4-8", "anthropic/claude-sonnet-5"];

const HEALTHY = {
  defaultProvider: "openrouter",
  defaultModel: "deepseek/deepseek-v4-pro",
  defaultThinkingLevel: "high",
  packages: [
    "git:github.com/MarylandLegalAid/mla-pi",
    "npm:pi-subagents",
    "npm:@juicesharp/rpiv-ask-user-question",
    "npm:pi-web-access",
  ],
  subagents: {
    agentOverrides: {
      "mla-worker": { model: "openrouter/xiaomi/mimo-v2.5-pro" },
      "mla-reviewer": { model: "openrouter/z-ai/glm-5.2" },
    },
  },
};

const HEALTHY_AUTH = { openrouter: { type: "api_key", key: "sk-or-test-fixture" } };

// A base env that makes every *new* check pass, so each test below can flip
// exactly one thing off. HOME/GIT_CONFIG_NOSYSTEM isolate git identity from
// this machine's real global config; MLA_PI_ROUTING_URL points routing
// freshness at an address nothing is listening on, which doctor must treat as
// informational (offline), never a failure.
const baseEnv = (agentDir) => ({
  PI_CODING_AGENT_DIR: agentDir,
  HOME: fakeHome({ name: "Test User", email: "test@example.org" }),
  GIT_CONFIG_NOSYSTEM: "1",
  MLA_PI_ROUTING_URL: "http://127.0.0.1:1/unreachable",
});

const doctor = (dir, agentDir, binDir, envOverrides = {}) =>
  run(join(dir, "scripts", "doctor.mjs"), [], {
    cwd: dir,
    binDir,
    env: { ...baseEnv(agentDir), ...envOverrides },
  });

test("a fully set up machine passes", () => {
  const dir = repoCopy();
  const agent = fakeAgentDir(HEALTHY, { workflow: "none" }, HEALTHY_AUTH);
  const r = doctor(dir, agent, fakeBin({ pi: REAL, gh: "authed" }));
  assert.equal(r.code, 0, out(r));
  assert.match(r.stdout, /0 failure\(s\)/);
  assert.match(r.stdout, /reviewer is a second opinion/);
  assert.match(r.stdout, /OpenRouter auth/);
  assert.match(r.stdout, /session model applied/);
  assert.match(r.stdout, /git identity/);
  assert.match(r.stdout, /gh auth/);
});

test("the reviewer collapse is a failure, not a warning", () => {
  const dir = repoCopy();
  // Provider the config does not target: every role falls back to the session
  // model, so worker and reviewer land on the same one.
  const agent = fakeAgentDir(HEALTHY, { workflow: "none" }, HEALTHY_AUTH);
  const r = doctor(dir, agent, fakeBin({ pi: OTHER, gh: "authed" }));
  assert.equal(r.code, 1);
  assert.match(r.stdout, /FAIL\s+reviewer is a second opinion/);
  assert.match(r.stdout, /worker and reviewer both resolve to/);
  assert.match(r.stdout, /suggest-models/);
});

test("a missing hard-dependency package fails", () => {
  const dir = repoCopy();
  const settings = structuredClone(HEALTHY);
  settings.packages = settings.packages.filter((p) => !p.includes("pi-subagents"));
  const r = doctor(dir, fakeAgentDir(settings, { workflow: "none" }, HEALTHY_AUTH), fakeBin({ pi: REAL, gh: "authed" }));
  assert.equal(r.code, 1);
  assert.match(r.stdout, /FAIL\s+package pi-subagents/);
  assert.match(r.stdout, /bootstrap\.sh/);
});

test("a missing pi-web-access is a warning, not a failure", () => {
  const dir = repoCopy();
  const settings = structuredClone(HEALTHY);
  settings.packages = settings.packages.filter((p) => !p.includes("pi-web-access"));
  const r = doctor(dir, fakeAgentDir(settings, { workflow: "none" }, HEALTHY_AUTH), fakeBin({ pi: REAL, gh: "authed" }));
  assert.equal(r.code, 0, "web research is degradable; preflight says so");
  assert.match(r.stdout, /warn\s+package pi-web-access/);
});

test("missing routing is a warning", () => {
  const dir = repoCopy();
  const settings = structuredClone(HEALTHY);
  delete settings.subagents;
  const r = doctor(dir, fakeAgentDir(settings, { workflow: "none" }, HEALTHY_AUTH), fakeBin({ pi: REAL, gh: "authed" }));
  assert.equal(r.code, 0);
  assert.match(r.stdout, /warn\s+model routing applied/);
  assert.match(r.stdout, /apply-models/);
});

test("an absent curator config is reported with its fix", () => {
  const dir = repoCopy();
  const r = doctor(dir, fakeAgentDir(HEALTHY, null, HEALTHY_AUTH), fakeBin({ pi: REAL, gh: "authed" }));
  assert.equal(r.code, 0);
  assert.match(r.stdout, /warn\s+search curator/);
});

test("model checks are skipped, not guessed, when pi is unavailable", () => {
  const dir = repoCopy();
  const r = run(join(dir, "scripts", "doctor.mjs"), [], {
    cwd: dir,
    env: {
      ...baseEnv(fakeAgentDir(HEALTHY, { workflow: "none" }, HEALTHY_AUTH)),
      PATH: isolatedPath(fakeBin({ gh: "authed" })),
    },
  });
  assert.match(r.stdout, /FAIL\s+pi on PATH/);
  assert.match(r.stdout, /warn\s+model catalog/);
  assert.equal(r.code, 1);
});

// ------------------------------------------------------------- OpenRouter auth

test("a missing OpenRouter key is a failure", () => {
  const dir = repoCopy();
  const agent = fakeAgentDir(HEALTHY, { workflow: "none" }); // no auth.json
  const r = doctor(dir, agent, fakeBin({ pi: REAL, gh: "authed" }));
  assert.equal(r.code, 1);
  assert.match(r.stdout, /FAIL\s+OpenRouter auth/);
  assert.match(r.stdout, /OPENROUTER_API_KEY/);
});

test("OPENROUTER_API_KEY in the environment satisfies the check without auth.json", () => {
  const dir = repoCopy();
  const agent = fakeAgentDir(HEALTHY, { workflow: "none" });
  const r = doctor(dir, agent, fakeBin({ pi: REAL, gh: "authed" }), { OPENROUTER_API_KEY: "sk-or-env" });
  assert.match(r.stdout, /ok\s+OpenRouter auth/);
});

// ---------------------------------------------------------------- session model

test("session model applied fails when defaultProvider/defaultModel do not match config", () => {
  const dir = repoCopy();
  const settings = structuredClone(HEALTHY);
  settings.defaultProvider = "opencode-go";
  settings.defaultModel = "deepseek-v4-flash";
  const r = doctor(dir, fakeAgentDir(settings, { workflow: "none" }, HEALTHY_AUTH), fakeBin({ pi: REAL, gh: "authed" }));
  assert.match(r.stdout, /warn\s+session model applied/);
  assert.match(r.stdout, /apply-models/);
});

// -------------------------------------------------------------------- git identity

test("git identity fails when no name/email is configured anywhere", () => {
  const dir = repoCopy();
  const agent = fakeAgentDir(HEALTHY, { workflow: "none" }, HEALTHY_AUTH);
  const r = run(join(dir, "scripts", "doctor.mjs"), [], {
    cwd: dir,
    binDir: fakeBin({ pi: REAL, gh: "authed" }),
    env: {
      PI_CODING_AGENT_DIR: agent,
      HOME: fakeHome(), // no .gitconfig at all
      GIT_CONFIG_NOSYSTEM: "1",
      MLA_PI_ROUTING_URL: "http://127.0.0.1:1/unreachable",
    },
  });
  assert.equal(r.code, 1);
  assert.match(r.stdout, /FAIL\s+git identity/);
  assert.match(r.stdout, /git config --global user\.name/);
});

test("git identity passes when name and email are set globally", () => {
  const dir = repoCopy();
  const r = doctor(dir, fakeAgentDir(HEALTHY, { workflow: "none" }, HEALTHY_AUTH), fakeBin({ pi: REAL, gh: "authed" }));
  assert.match(r.stdout, /ok\s+git identity\s+Test User <test@example\.org>/);
});

// -------------------------------------------------------------------- gh auth

test("gh not on PATH is a failure distinct from not authenticated", () => {
  const dir = repoCopy();
  const agent = fakeAgentDir(HEALTHY, { workflow: "none" }, HEALTHY_AUTH);
  const r = run(join(dir, "scripts", "doctor.mjs"), [], {
    cwd: dir,
    env: { ...baseEnv(agent), PATH: isolatedPath(fakeBin({ pi: REAL })) },
  });
  assert.equal(r.code, 1);
  assert.match(r.stdout, /FAIL\s+gh auth\s+gh not on PATH/);
});

test("gh present but not authenticated is a failure", () => {
  const dir = repoCopy();
  const r = doctor(dir, fakeAgentDir(HEALTHY, { workflow: "none" }, HEALTHY_AUTH), fakeBin({ pi: REAL, gh: "unauthed" }));
  assert.equal(r.code, 1);
  assert.match(r.stdout, /FAIL\s+gh auth\s+not authenticated/);
  assert.match(r.stdout, /gh auth login/);
});

// -------------------------------------------------------------- routing freshness

test("an unreachable routing URL is reported as offline, not a failure", () => {
  const dir = repoCopy();
  const r = doctor(dir, fakeAgentDir(HEALTHY, { workflow: "none" }, HEALTHY_AUTH), fakeBin({ pi: REAL, gh: "authed" }));
  assert.equal(r.code, 0, out(r));
  assert.match(r.stdout, /ok\s+routing freshness\s+offline/);
});

// ------------------------------------------------------------ apply-web-search

const webSearch = (dir, agentDir, args = []) =>
  run(join(dir, "scripts", "apply-web-search.mjs"), args, {
    cwd: dir,
    env: { PI_CODING_AGENT_DIR: agentDir },
  });

test("writes workflow: none on a fresh machine", () => {
  const dir = repoCopy();
  const agent = tmp();
  const r = webSearch(dir, agent);
  assert.equal(r.code, 0, out(r));
  assert.equal(readJson(join(agent, "web-search.json")).workflow, "none");
});

test("leaves a deliberate /curator on alone", () => {
  const dir = repoCopy();
  const agent = tmp();
  writeFileSync(join(agent, "web-search.json"), JSON.stringify({ workflow: "summary-review" }));
  const r = webSearch(dir, agent);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /already set\s+workflow: summary-review/);
  assert.equal(readJson(join(agent, "web-search.json")).workflow, "summary-review");
});

test("preserves sibling keys when filling workflow in", () => {
  const dir = repoCopy();
  const agent = tmp();
  writeFileSync(
    join(agent, "web-search.json"),
    JSON.stringify({ provider: "brave", curatorTimeoutSeconds: 45 }),
  );
  assert.equal(webSearch(dir, agent).code, 0);
  const after = readJson(join(agent, "web-search.json"));
  assert.equal(after.workflow, "none");
  assert.equal(after.provider, "brave");
  assert.equal(after.curatorTimeoutSeconds, 45);
});

test("leaves an unparseable config untouched and does not abort bootstrap", () => {
  const dir = repoCopy();
  const agent = tmp();
  writeFileSync(join(agent, "web-search.json"), "{ oops");
  const r = webSearch(dir, agent);
  assert.equal(r.code, 0, "bootstrap runs under set -e; a bad config must not strand it");
  assert.match(r.stdout, /is not valid JSON/);
  assert.equal(readFileSync(join(agent, "web-search.json"), "utf8"), "{ oops");
});

test("--dry-run writes nothing", () => {
  const dir = repoCopy();
  const agent = tmp();
  const r = webSearch(dir, agent, ["--dry-run"]);
  assert.equal(r.code, 0);
  assert.equal(exists(join(agent, "web-search.json")), false);
});

test("honours XDG_CONFIG_HOME the way pi-web-access does", () => {
  const dir = repoCopy();
  const xdg = tmp();
  const r = run(join(dir, "scripts", "apply-web-search.mjs"), [], {
    cwd: dir,
    env: { PI_CODING_AGENT_DIR: "", XDG_CONFIG_HOME: xdg },
  });
  assert.equal(r.code, 0, out(r));
  assert.equal(readJson(join(xdg, "pi", "web-search.json")).workflow, "none");
});
