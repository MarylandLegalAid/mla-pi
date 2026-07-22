// install.sh. It runs real package installs and prompts for real secrets, so
// this suite does not execute the install flow - it checks syntax, lints it,
// and unit-tests the one part cheap to isolate: platform detection. Sourcing
// with MLA_PI_TEST_SOURCE=1 stops the script right after $FAMILY is set and
// before anything installs, prompts, or calls `die`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { writeFileSync, symlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { REPO, tmp } from "./support/harness.mjs";

const INSTALL_SH = join(REPO, "install.sh");
// Absolute, not looked up on PATH: several tests below deliberately construct a
// PATH missing everything except a couple of named stubs.
const BASH = execFileSync("/bin/sh", ["-c", "command -v bash"], { encoding: "utf8" }).trim();
const GREP = execFileSync("/bin/sh", ["-c", "command -v grep"], { encoding: "utf8" }).trim();
// Empty string if not installed. See pathWithManagers for why this is on the isolated PATH.
const GETTEXT = execFileSync("/bin/sh", ["-c", "command -v gettext || true"], { encoding: "utf8" }).trim();

test("install.sh has valid bash syntax", () => {
  execFileSync(BASH, ["-n", INSTALL_SH], { stdio: "pipe" });
});

test("install.sh passes shellcheck", { skip: shouldSkipShellcheck() }, () => {
  execFileSync("shellcheck", [INSTALL_SH], { encoding: "utf8" });
});

function shouldSkipShellcheck() {
  try {
    execFileSync("shellcheck", ["--version"], { stdio: "ignore" });
    return false; // present -> run the test
  } catch {
    return "shellcheck not installed on this machine"; // absent -> skip with reason
  }
}

/** A fixture /etc/os-release-style file with the given fields. */
function osRelease(fields) {
  const dir = tmp("piwf-osrel-");
  const path = join(dir, "os-release");
  writeFileSync(path, Object.entries(fields).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
  return path;
}

/** Source install.sh up to the platform-detection stop point and report $FAMILY/$OS_ID. */
function detectPlatform({ osReleaseFields, isWsl = false, path = process.env.PATH }) {
  const procVersion = join(tmp("piwf-procver-"), "version");
  writeFileSync(procVersion, isWsl ? "Linux version 5.15 (Microsoft@WSL2)\n" : "Linux version 6.8 (generic)\n");

  const out = execFileSync(
    BASH,
    ["-c", `set -e; MLA_PI_TEST_SOURCE=1 source "${INSTALL_SH}"; echo "FAMILY=$FAMILY OS_ID=$OS_ID"`],
    {
      encoding: "utf8",
      env: {
        PATH: path,
        MLA_PI_OS_RELEASE: osRelease(osReleaseFields),
        MLA_PI_PROC_VERSION: procVersion,
      },
    },
  );
  const family = out.match(/FAMILY=(\S*)/)[1];
  const osId = out.match(/OS_ID=(\S*)/)[1];
  return { family, osId, stdout: out };
}

/**
 * A PATH containing only `grep` (needed for the WSL /proc/version check) and
 * `gettext` (see below) plus fake stubs for the named package managers - nothing
 * else, so a manager left off this list is genuinely unresolvable, not just shadowed.
 *
 * gettext looks out of place on a PATH this deliberately bare, but leaving it off
 * is a fork bomb on Fedora. When install.sh runs a command missing from this PATH,
 * Fedora's bash fires its PackageKit `command_not_found_handle`, which shells out to
 * `gettext` to localize the "command not found" message. With gettext also off the
 * PATH, that call misses too - re-entering the handler, which calls gettext again,
 * recursing without bound until the machine is out of processes. Resolving gettext
 * lets the handler finish and return a plain 127, exactly as a bare lookup would.
 * It is not a package manager, so it does not affect what these tests actually probe.
 */
function pathWithManagers(managers) {
  const dir = tmp("piwf-pm-");
  symlinkSync(GREP, join(dir, "grep"));
  if (GETTEXT) symlinkSync(GETTEXT, join(dir, "gettext"));
  for (const name of managers) {
    writeFileSync(join(dir, name), "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });
  }
  return dir;
}

test("detects debian family from ubuntu/ID_LIKE=debian, with apt-get present", () => {
  const { family, osId } = detectPlatform({
    osReleaseFields: { ID: "ubuntu", ID_LIKE: '"debian"', VERSION_ID: '"24.04"' },
    path: pathWithManagers(["apt-get"]),
  });
  assert.equal(family, "debian");
  assert.equal(osId, "ubuntu");
});

test("detects fedora family, with dnf present", () => {
  const { family } = detectPlatform({
    osReleaseFields: { ID: "fedora", VERSION_ID: "44" },
    path: pathWithManagers(["dnf"]),
  });
  assert.equal(family, "fedora");
});

test("detects arch family, with pacman present", () => {
  const { family } = detectPlatform({
    osReleaseFields: { ID: "arch" },
    path: pathWithManagers(["pacman"]),
  });
  assert.equal(family, "arch");
});

test("a debian-like ID with no apt-get on PATH resolves to no family", () => {
  const { family } = detectPlatform({
    osReleaseFields: { ID: "ubuntu", ID_LIKE: '"debian"' },
    path: pathWithManagers([]), // grep only - deliberately no apt-get anywhere
  });
  assert.equal(family, "", "family must not be claimed without the package manager actually present");
});

test("an unrecognized distro resolves to no family", () => {
  const { family } = detectPlatform({
    osReleaseFields: { ID: "alpine" },
    path: pathWithManagers(["apk"]),
  });
  assert.equal(family, "");
});

test("WSL is detected and noted, but behaves like native Linux otherwise", () => {
  const { family, stdout } = detectPlatform({
    osReleaseFields: { ID: "ubuntu", ID_LIKE: '"debian"' },
    isWsl: true,
    path: pathWithManagers(["apt-get"]),
  });
  assert.equal(family, "debian");
  assert.match(stdout, /WSL detected/);
});

test("no /etc/os-release equivalent readable is a hard stop", () => {
  const dir = tmp("piwf-noosrel-");
  const missing = join(dir, "does-not-exist");
  assert.throws(() => {
    execFileSync(BASH, ["-c", `MLA_PI_TEST_SOURCE=1 MLA_PI_OS_RELEASE="${missing}" source "${INSTALL_SH}"`], {
      encoding: "utf8",
      stdio: "pipe",
    });
  }, /cannot read/);
});
