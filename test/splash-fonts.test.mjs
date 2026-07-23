// scripts/splash-fonts.mjs is a dev-only tool (needs an ad hoc, not-committed
// `npm install figlet --no-save` - see its module comment) that must never be
// on the runtime path and must never crash obscurely when that ad hoc install
// hasn't been done, which is the state anyone freshly cloning this repo (and
// CI) is actually in.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { REPO, run } from "./support/harness.mjs";

const SCRIPT = join(REPO, "scripts", "splash-fonts.mjs");

test("without an ad hoc figlet install, it exits with a clear instruction instead of crashing", () => {
  const r = run(SCRIPT);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /npm install figlet --no-save/);
});
