// validate.mjs --shards. These encode the failure that produced them: a scraping
// package sized by its diff, killed mid-crawl by the default 25-minute budget.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { writeFileSync, mkdirSync, renameSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { REPO, run, out, tmp } from "./support/harness.mjs";

/** Write a plan directory from {filename: frontmatter-object}. */
function plan(shards) {
  const dir = join(tmp(), "plan");
  mkdirSync(dir, { recursive: true });
  for (const [id, fm] of Object.entries(shards)) {
    // An undefined value means "omit this key" - writing the string "undefined"
    // would make the key present and truthy, quietly inverting the test.
    const lines = Object.entries(fm)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) =>
        Array.isArray(v) ? `${k}:\n${v.map((i) => `  - ${i}`).join("\n")}` : `${k}: ${v}`,
      );
    writeFileSync(
      join(dir, `${id}.md`),
      `---\nid: ${id}\n${lines.join("\n")}\n---\n\n# Goal\nDone.\n`,
    );
  }
  return dir;
}

const check = (dir) => run(join(REPO, "scripts", "validate.mjs"), ["--shards", dir], { cwd: REPO });

const OK_SHARD = {
  depends_on: [],
  owns: ["src/**"],
  acceptance: ['"pnpm test passes"'],
  manual: false,
  network: false,
};

test("a well-formed plan passes", () => {
  const r = check(plan({ "01-a": OK_SHARD, "02-b": { ...OK_SHARD, depends_on: ["01-a"] } }));
  assert.equal(r.code, 0, out(r));
});

test("network: true without timeout_min is rejected", () => {
  const r = check(plan({ "01-crawl": { ...OK_SHARD, network: true } }));
  assert.equal(r.code, 1);
  assert.match(out(r), /network: true needs an explicit timeout_min/);
});

test("network: true with timeout_min passes", () => {
  const r = check(plan({ "01-crawl": { ...OK_SHARD, network: true, timeout_min: 90 } }));
  assert.equal(r.code, 0, out(r));
});

test("network: true with manual: true passes without a timeout", () => {
  const r = check(plan({ "01-crawl": { ...OK_SHARD, owns: undefined, network: true, manual: true } }));
  assert.equal(r.code, 0, out(r));
});

test("timeout_min must be integer minutes", () => {
  for (const bad of ["90000ms", "0", "-5", "1.5"]) {
    const r = check(plan({ "01-a": { ...OK_SHARD, timeout_min: bad } }));
    assert.equal(r.code, 1, `accepted timeout_min: ${bad}`);
    assert.match(out(r), /timeout_min must be a positive integer/);
  }
});

test("an id that does not match its filename is rejected", () => {
  const dir = plan({ "01-a": OK_SHARD });
  writeFileSync(
    join(dir, "01-a.md"),
    "---\nid: 99-wrong\ndepends_on:\nowns:\n  - src/**\nacceptance:\n  - \"x\"\n---\n\n# Goal\n",
  );
  const r = check(dir);
  assert.equal(r.code, 1);
  assert.match(out(r), /must match the filename/);
});

test("plan's NN-<id>.md filename is accepted", () => {
  const dir = plan({ "01-a": OK_SHARD });
  // Rename to the prefixed form plan actually writes.
  renameSync(join(dir, "01-a.md"), join(dir, "07-01-a.md"));
  const r = check(dir);
  assert.equal(r.code, 0, out(r));
});

test("depends_on naming a nonexistent shard is rejected", () => {
  const r = check(plan({ "01-a": { ...OK_SHARD, depends_on: ["99-ghost"] } }));
  assert.equal(r.code, 1);
  assert.match(out(r), /depends_on names a shard that does not exist: 99-ghost/);
});

test("a dependency cycle is rejected", () => {
  const r = check(
    plan({
      "01-a": { ...OK_SHARD, depends_on: ["02-b"] },
      "02-b": { ...OK_SHARD, depends_on: ["01-a"] },
    }),
  );
  assert.equal(r.code, 1);
  assert.match(out(r), /depends_on cycle/);
});

test("manual packages must not own files", () => {
  const r = check(plan({ "01-dns": { ...OK_SHARD, manual: true } }));
  assert.equal(r.code, 1);
  assert.match(out(r), /manual: true packages must have no owns/);
});

test("a non-manual package must own something", () => {
  const r = check(plan({ "01-a": { ...OK_SHARD, owns: undefined } }));
  assert.equal(r.code, 1);
  assert.match(out(r), /owns is required unless manual: true/);
});

test("missing acceptance criteria are rejected", () => {
  const r = check(plan({ "01-a": { ...OK_SHARD, acceptance: undefined } }));
  assert.equal(r.code, 1);
  assert.match(out(r), /acceptance is required and must be a list/);
});

test("an open question left in the body is rejected", () => {
  const dir = plan({ "01-a": OK_SHARD });
  writeFileSync(
    join(dir, "01-a.md"),
    `---\nid: 01-a\ndepends_on:\nowns:\n  - src/**\nacceptance:\n  - "x"\n---\n\n# Goal\nTBD which library.\n`,
  );
  const r = check(dir);
  assert.equal(r.code, 1);
  assert.match(out(r), /open question left in the shard/);
});

test("a nonexistent plan directory is reported", () => {
  const r = check(join(tmp(), "nope"));
  assert.equal(r.code, 1);
  assert.match(out(r), /no such directory/);
});

test("--shards without a directory is reported", () => {
  const r = run(join(REPO, "scripts", "validate.mjs"), ["--shards"], { cwd: REPO });
  assert.equal(r.code, 1);
  assert.match(out(r), /needs a directory/);
});

test("the repo still validates when --shards is absent", () => {
  const r = run(join(REPO, "scripts", "validate.mjs"), [], { cwd: REPO });
  assert.equal(r.code, 0, out(r));
});

// ------------------------------------------------- planning artifacts in git

/** A git repo with a plan dir at <root>/.pi-workflow/plan. */
function project({ ignore = true, stage = false } = {}) {
  const root = tmp();
  const planDir = join(root, ".pi-workflow", "plan");
  mkdirSync(planDir, { recursive: true });
  writeFileSync(
    join(planDir, "01-a.md"),
    `---\nid: 01-a\ndepends_on:\nowns:\n  - src/**\nacceptance:\n  - "x"\n---\n\n# Goal\nDone.\n`,
  );
  writeFileSync(join(root, ".pi-workflow", "state.json"), "{}");
  const git = (...args) => execFileSync("git", ["-C", root, ...args], { stdio: "ignore" });
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  if (stage) git("add", "-Af");
  writeFileSync(join(root, ".gitignore"), ignore ? ".pi-workflow/\n.pi-subagents/\n" : "node_modules/\n");
  return planDir;
}

test("an unignored .pi-workflow is rejected", () => {
  const r = check(project({ ignore: false }));
  assert.equal(r.code, 1);
  assert.match(out(r), /\.pi-workflow\/ is not gitignored/);
});

test("an ignored .pi-workflow passes", () => {
  const r = check(project({ ignore: true }));
  assert.equal(r.code, 0, out(r));
});

test("artifacts already staged are rejected even when gitignored", () => {
  const r = check(project({ ignore: true, stage: true }));
  assert.equal(r.code, 1, "a .gitignore entry does not untrack a staged file");
  assert.match(out(r), /tracked by git despite \.gitignore/);
  assert.match(out(r), /rm -r --cached/);
});
