// check-routing-fresh.mjs. The comparison itself is tested directly (imported,
// no subprocess, no network) since it is pure; the CLI is tested end-to-end
// only for the network-condition paths that don't depend on actually reaching a
// listener - this sandbox's child processes cannot reach a server bound by the
// parent test process, so a real fresh/stale round trip isn't something this
// suite can exercise reliably; the imported compare() test covers that logic.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readFileSync, rmSync } from "node:fs";
import { REPO, repoCopy, run, out } from "./support/harness.mjs";
import { compare } from "../scripts/check-routing-fresh.mjs";

// --------------------------------------------------------------- compare()

test("compare: identical content is fresh", () => {
  assert.equal(compare('{"a":1}', '{"a":1}'), "fresh");
});

test("compare: different content is stale", () => {
  assert.equal(compare('{"a":1}', '{"a":2}'), "stale");
});

test("compare: differs only by surrounding whitespace is still fresh", () => {
  assert.equal(compare('{"a":1}\n', '  {"a":1}  \n\n'), "fresh");
});

// ------------------------------------------------------------------- CLI

const check = (dir, url) =>
  run(join(dir, "scripts", "check-routing-fresh.mjs"), [], {
    cwd: dir,
    env: { MLA_PI_ROUTING_URL: url },
  });

test("an unreachable host is treated as offline, never a failure", () => {
  const dir = repoCopy();
  const r = check(dir, "http://127.0.0.1:1/unreachable");
  assert.equal(r.code, 0, out(r));
  assert.match(r.stdout, /^offline/);
});

test("a malformed URL is treated as offline, never a failure", () => {
  const dir = repoCopy();
  const r = check(dir, "not-a-valid-url");
  assert.equal(r.code, 0, out(r));
  assert.match(r.stdout, /^offline/);
});

test("a missing local config/models.json is a real error, not offline", () => {
  const dir = repoCopy();
  rmSync(join(dir, "config", "models.json"));
  const r = check(dir, "http://127.0.0.1:1/unreachable");
  assert.equal(r.code, 1);
  assert.match(out(r), /cannot read/);
});

test("the real config/models.json is readable and hashable", () => {
  const local = readFileSync(join(REPO, "config", "models.json"), "utf8");
  assert.equal(compare(local, local), "fresh");
});
