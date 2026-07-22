// Test harness. Zero dependencies, same rule as scripts/.
//
// The scripts under test are CLIs that read the real machine: `pi --list-models`,
// `gh auth status`, `git config`, ~/.pi/agent/settings.json, the repo they sit in.
// Testing them means running them as subprocesses against a fake machine, not
// importing them - which is also exactly how they fail in the wild.

import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

export const REPO = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

const temps = [];

/** A throwaway directory, removed when the process exits. */
export function tmp(prefix = "piwf-") {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

process.on("exit", () => {
  for (const dir of temps) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
});

/**
 * A copy of the repo that tests may mutate freely. Excludes .git and node_modules
 * so the copy is cheap and cannot corrupt the working tree.
 */
export function repoCopy() {
  const dir = tmp("piwf-repo-");
  cpSync(REPO, dir, {
    recursive: true,
    filter: (src) => !src.includes("/.git/") && !src.endsWith("/.git") && !src.includes("node_modules"),
  });
  return dir;
}

/**
 * A directory on PATH containing stub binaries. Pass `pi` (a list of
 * "provider/model" strings, or [] for an authenticated-but-empty catalog) and/or
 * `gh` ("authed" | "unauthed") to include that stub; omit either to leave it out
 * of the directory entirely (so a PATH built from just this dir behaves as if
 * that tool were not installed).
 */
export function fakeBin({ pi, gh, piVersion = "0.81.1" } = {}) {
  const dir = tmp("piwf-bin-");
  if (pi) {
    const lines = pi.map((m) => {
      const [provider, ...rest] = m.split("/");
      return `echo "${provider} ${rest.join("/")}"`;
    });
    writeFileSync(
      join(dir, "pi"),
      `#!/usr/bin/env bash
[ "$1" = "--version" ] && { echo "${piVersion}"; exit 0; }
[ "$1" = "--list-models" ] && { echo "PROVIDER MODEL"; ${lines.join("; ")}; exit 0; }
exit 0
`,
      { mode: 0o755 },
    );
  }
  if (gh) {
    const exit = gh === "authed" ? 0 : 1;
    writeFileSync(
      join(dir, "gh"),
      `#!/usr/bin/env bash
if [ "$1" = "--version" ]; then echo "gh version 2.99.0 (fake)"; exit 0; fi
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then exit ${exit}; fi
exit 0
`,
      { mode: 0o755 },
    );
  }
  return dir;
}

/** Back-compat single-purpose alias: a fake `pi` bin dir. */
export const fakePi = (models, opts = {}) => fakeBin({ pi: models, piVersion: opts.version });

/**
 * A PATH with nothing real reachable. Use as the base of a hermetic PATH:
 * `${fakeBinDir}:${EMPTY_PATH_DIR}` so an absent stub (say, no `gh` in that
 * dir) cannot fall through to whatever the test-running machine happens to
 * have installed - this machine has both `pi` and `gh` for real, so a plain
 * PATH prepend would silently pass tests it should fail.
 */
export const EMPTY_PATH_DIR = "/nonexistent-for-tests";
export const PATH_WITHOUT_PI = EMPTY_PATH_DIR; // legacy name, same sentinel

/** A hermetic PATH containing only `dir` - nothing else on this machine is reachable. */
export const isolatedPath = (dir) => `${dir}:${EMPTY_PATH_DIR}`;

/** Write a pi agent settings.json (and optionally web-search.json / auth.json) under a fake PI_CODING_AGENT_DIR. */
export function fakeAgentDir(settings = {}, webSearch = null, auth = null) {
  const dir = tmp("piwf-agent-");
  mkdirSync(join(dir, "agent"), { recursive: true });
  writeFileSync(join(dir, "agent", "settings.json"), JSON.stringify(settings, null, 2));
  if (webSearch !== null) writeFileSync(join(dir, "web-search.json"), JSON.stringify(webSearch, null, 2));
  if (auth !== null) writeFileSync(join(dir, "agent", "auth.json"), JSON.stringify(auth, null, 2));
  return dir;
}

/**
 * A fake $HOME with (or without) a global .gitconfig, for testing git-identity
 * checks without touching or reading the real machine's git config. Pair with
 * `env: { HOME: fakeHome(...), GIT_CONFIG_NOSYSTEM: "1" }` so no system-wide
 * gitconfig on the test-running machine can leak through either.
 */
export function fakeHome({ name, email } = {}) {
  const dir = tmp("piwf-home-");
  if (name || email) {
    const lines = ["[user]"];
    if (name) lines.push(`\tname = ${name}`);
    if (email) lines.push(`\temail = ${email}`);
    writeFileSync(join(dir, ".gitconfig"), `${lines.join("\n")}\n`);
  }
  return dir;
}

/**
 * Run a script. Never throws on a non-zero exit - the exit code is usually the
 * thing under test - so every caller must assert on `code` explicitly.
 */
export function run(script, args = [], { cwd = REPO, env = {}, binDir = null } = {}) {
  const path = binDir ? `${binDir}:${process.env.PATH}` : process.env.PATH;
  try {
    const stdout = execFileSync(process.execPath, [script, ...args], {
      cwd,
      encoding: "utf8",
      timeout: 60_000,
      env: { ...process.env, PATH: path, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout, stderr: "" };
  } catch (e) {
    return {
      code: e.status ?? 1,
      stdout: e.stdout?.toString() ?? "",
      stderr: e.stderr?.toString() ?? "",
    };
  }
}

/** Combined output, for assertions that do not care which stream carried it. */
export const out = (r) => `${r.stdout}${r.stderr}`;

export const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
export const exists = existsSync;

/** Replace the first occurrence of `find` (string or regex) in a file. Throws if absent. */
export function patch(file, find, replace) {
  const text = readFileSync(file, "utf8");
  const hit = typeof find === "string" ? text.includes(find) : find.test(text);
  if (!hit) throw new Error(`patch target not found in ${file}: ${find}`);
  writeFileSync(file, text.replace(find, replace));
}

/**
 * Secret-shaped fixtures, assembled at runtime.
 *
 * A literal AWS key or PEM header in a test file is a real hit: validate.mjs walks
 * the whole repo, test/ included, and it is right to. Splitting the literals keeps
 * the fixtures effective without putting a permanent finding in the tree - and
 * keeps test/ inside the scan rather than carving out a blind spot.
 */
export const fixtures = {
  awsKey: () => `AKIA${"IOSFODNN7EXAMPLE"}`,
  pemHeader: () => `-----BEGIN RSA PRIVATE${" KEY-----"}`,
};
