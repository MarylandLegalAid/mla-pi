#!/usr/bin/env node
// Compares this machine's config/models.json against mla-pi's main branch, so an
// org-wide model change (new release, price change, budget squeeze) reaches
// staff as a one-line nudge instead of silence. Never blocks: staleness is
// informational, and no network is silent success either way.
//
//   node scripts/check-routing-fresh.mjs
//
// Zero dependencies, same as the other scripts here.

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const hash = (s) => createHash("sha256").update(s.trim()).digest("hex");

/** Pure comparison - unit-testable without a network call or a subprocess. */
export function compare(local, remote) {
  return hash(local) === hash(remote) ? "fresh" : "stale";
}

async function main() {
  const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
  const REMOTE_URL =
    process.env.MLA_PI_ROUTING_URL ??
    "https://raw.githubusercontent.com/<MLA-ORG>/mla-pi/main/config/models.json";
  const TIMEOUT_MS = 2500;

  const localPath = join(ROOT, "config", "models.json");
  let local;
  try {
    local = readFileSync(localPath, "utf8");
  } catch (e) {
    console.log(`error: cannot read ${localPath}: ${e.message}`);
    process.exit(1);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(REMOTE_URL, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) {
      // Includes the placeholder <MLA-ORG> URL 404ing before the org does its
      // find-replace at publish time - treated the same as no network.
      console.log(`offline (fetch returned ${res.status})`);
      process.exit(0);
    }
    const remote = await res.text();
    if (compare(local, remote) === "fresh") {
      console.log("fresh");
    } else {
      console.log(
        "stale - update: pi update git:github.com/<MLA-ORG>/mla-pi && " +
          `node ${join(ROOT, "scripts", "apply-models.mjs")}`,
      );
    }
    process.exit(0);
  } catch {
    clearTimeout(timer);
    console.log("offline");
    process.exit(0);
  }
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main();
}
