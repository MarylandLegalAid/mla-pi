// Every seeded fault that docs/verification.md claims validate.mjs catches.
// Each one mutates a throwaway copy of the repo, so a passing suite is evidence
// the guard still works rather than that it once did.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { writeFileSync, readFileSync, rmSync } from "node:fs";
import { REPO, repoCopy, run, out, patch, fixtures } from "./support/harness.mjs";

const validate = (dir) => run(join(dir, "scripts", "validate.mjs"), [], { cwd: dir });

test("the repo as committed is valid", () => {
  const r = validate(REPO);
  assert.equal(r.code, 0, out(r));
  assert.match(r.stdout, /mla-pi: valid/);
});

test("reviewer sharing the worker's model is rejected", () => {
  const dir = repoCopy();
  const cfg = JSON.parse(readFileSync(join(dir, "config", "models.json"), "utf8"));
  cfg.roles.reviewer.model = cfg.roles.worker.model;
  writeFileSync(join(dir, "config", "models.json"), JSON.stringify(cfg, null, 2));
  const r = validate(dir);
  assert.equal(r.code, 1);
  assert.match(out(r), /roles\.reviewer must differ from roles\.worker/);
});

test("a missing required role is rejected", () => {
  const dir = repoCopy();
  const cfg = JSON.parse(readFileSync(join(dir, "config", "models.json"), "utf8"));
  delete cfg.roles.session;
  writeFileSync(join(dir, "config", "models.json"), JSON.stringify(cfg, null, 2));
  const r = validate(dir);
  assert.equal(r.code, 1);
  assert.match(out(r), /missing role: session/);
});

test("a role model not on the open-weight org list is a warning, not a failure", () => {
  const dir = repoCopy();
  const cfg = JSON.parse(readFileSync(join(dir, "config", "models.json"), "utf8"));
  cfg.roles.scout.model = "openrouter/openai/gpt-5-mini";
  writeFileSync(join(dir, "config", "models.json"), JSON.stringify(cfg, null, 2));
  const r = validate(dir);
  assert.equal(r.code, 0, out(r));
  assert.match(out(r), /not on the known open-weight org list/);
});

test("a three-segment OpenRouter model id is accepted", () => {
  // provider/org/model - the shape every real role in config/models.json uses.
  const dir = repoCopy();
  const cfg = JSON.parse(readFileSync(join(dir, "config", "models.json"), "utf8"));
  assert.match(cfg.roles.worker.model, /^openrouter\/[a-z0-9-]+\/[a-zA-Z0-9._-]+$/);
  const r = validate(dir);
  assert.equal(r.code, 0, out(r));
});

test("sudo in an install command with sudo: false is rejected", () => {
  const dir = repoCopy();
  patch(join(dir, "catalog", "tools.yaml"), 'install: "npm i -D vitest"', 'install: "sudo npm i -D vitest"');
  const r = validate(dir);
  assert.equal(r.code, 1);
  assert.match(out(r), /declares sudo: false but install uses sudo/);
});

test("a hardcoded model id in a skill is rejected", () => {
  const dir = repoCopy();
  const f = join(dir, "skills", "build", "SKILL.md");
  writeFileSync(f, `${readFileSync(f, "utf8")}\n\nUse opencode-go/kimi-k3 here.\n`);
  const r = validate(dir);
  assert.equal(r.code, 1);
  assert.match(out(r), /hardcoded model id/);
});

test("a hardcoded OpenRouter model id derived from config/models.json is rejected", () => {
  const dir = repoCopy();
  const f = join(dir, "skills", "build", "SKILL.md");
  writeFileSync(f, `${readFileSync(f, "utf8")}\n\nUse openrouter/deepseek/deepseek-v4-pro here.\n`);
  const r = validate(dir);
  assert.equal(r.code, 1);
  assert.match(out(r), /hardcoded model id/);
});

test("a bare mla- agent reference is rejected", () => {
  const dir = repoCopy();
  const f = join(dir, "skills", "build", "SKILL.md");
  writeFileSync(f, `${readFileSync(f, "utf8")}\n\nagent: "mla-worker"\n`);
  const r = validate(dir);
  assert.equal(r.code, 1);
  assert.match(out(r), /must be namespaced/);
});

test("a write tool on a read-only agent is rejected", () => {
  const dir = repoCopy();
  patch(join(dir, "agents", "mla-reviewer.md"), "tools: read", "tools: read, write");
  const r = validate(dir);
  assert.equal(r.code, 1);
  assert.match(out(r), /read-only agent but declares edit\/write/);
});

test("an agent whose package field is not mla-pi is rejected", () => {
  const dir = repoCopy();
  patch(join(dir, "agents", "mla-scout.md"), "package: mla-pi", "package: pi-workflow");
  const r = validate(dir);
  assert.equal(r.code, 1);
  assert.match(out(r), /package must be "mla-pi"/);
});

test("a role with no matching agent is rejected", () => {
  const dir = repoCopy();
  const cfg = JSON.parse(readFileSync(join(dir, "config", "models.json"), "utf8"));
  cfg.roles.editor = { model: "openrouter/deepseek/deepseek-v4-pro" };
  writeFileSync(join(dir, "config", "models.json"), JSON.stringify(cfg, null, 2));
  const r = validate(dir);
  assert.equal(r.code, 1);
  assert.match(out(r), /role editor has no matching agent/);
});

test("a reference to a nonexistent shared file is rejected", () => {
  const dir = repoCopy();
  const f = join(dir, "skills", "build", "SKILL.md");
  writeFileSync(f, `${readFileSync(f, "utf8")}\n\nRead shared/nope.md now.\n`);
  const r = validate(dir);
  assert.equal(r.code, 1);
  assert.match(out(r), /references a path that does not exist/);
});

test("dropping pi-subagents.agents from the manifest is rejected", () => {
  const dir = repoCopy();
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  delete pkg["pi-subagents"];
  writeFileSync(join(dir, "package.json"), JSON.stringify(pkg, null, 2));
  const r = validate(dir);
  assert.equal(r.code, 1);
  assert.match(out(r), /must be \["\.\/agents"\]/);
});

test("dropping pi.extensions from the manifest is rejected", () => {
  const dir = repoCopy();
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  delete pkg.pi.extensions;
  writeFileSync(join(dir, "package.json"), JSON.stringify(pkg, null, 2));
  const r = validate(dir);
  assert.equal(r.code, 1);
  assert.match(out(r), /pi\.extensions must be \["\.\/extensions"\]/);
});

test("an npm dependency is rejected", () => {
  const dir = repoCopy();
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  pkg.dependencies = { chalk: "^5.0.0" };
  writeFileSync(join(dir, "package.json"), JSON.stringify(pkg, null, 2));
  const r = validate(dir);
  assert.equal(r.code, 1);
  assert.match(out(r), /no npm dependencies allowed/);
});

// ------------------------------------------------------------------ platforms

test("a debian-family install with no fedora sibling is rejected", () => {
  const dir = repoCopy();
  patch(join(dir, "catalog", "tools.yaml"), '    install_fedora: "sudo dnf install -y jq"\n', "");
  const r = validate(dir);
  assert.equal(r.code, 1);
  assert.match(out(r), /"jq" install targets the debian family but has no install_fedora/);
});

test("an unsupported platform key is rejected", () => {
  const dir = repoCopy();
  patch(
    join(dir, "catalog", "tools.yaml"),
    '    install_fedora: "sudo dnf install -y jq"',
    '    install_suse: "sudo zypper install -y jq"',
  );
  const r = validate(dir);
  assert.equal(r.code, 1);
  assert.match(out(r), /unknown platform key "install_suse"/);
});

test("sudo inside a per-family key on a sudo: false entry is rejected", () => {
  const dir = repoCopy();
  patch(
    join(dir, "catalog", "tools.yaml"),
    '    install: "npm i -D vitest"',
    '    install: "npm i -D vitest"\n    install_fedora: "sudo dnf install -y vitest"',
  );
  const r = validate(dir);
  assert.equal(r.code, 1);
  assert.match(out(r), /but install_fedora uses sudo/);
});

test("install_family exposes a distro-bound install the inferrer cannot see", () => {
  const dir = repoCopy();
  const yaml = join(dir, "catalog", "tools.yaml");
  // az installs via `curl ... | sudo bash` - no package manager named, so the
  // requirement can only come from install_family. Drop its siblings and keep it.
  patch(yaml, /^ {4}install_fedora: "sudo rpm --import.*azure-cli"\n/m, "");
  patch(yaml, "    install_arch: MANUAL\n", "");
  const r = validate(dir);
  assert.equal(r.code, 1);
  assert.match(out(r), /"az" install targets the debian family but has no install_fedora/);
});

// ------------------------------------------------------------ secret patterns

test("a real-looking AWS key in the repo is caught", () => {
  const dir = repoCopy();
  writeFileSync(join(dir, "leak.md"), `${fixtures.awsKey()}\n`);
  const r = validate(dir);
  assert.equal(r.code, 1);
  assert.match(out(r), /possible AWS access key id committed/);
});

test("a private key header in the repo is caught", () => {
  const dir = repoCopy();
  writeFileSync(join(dir, "leak.pem"), `${fixtures.pemHeader()}\nabc\n`);
  const r = validate(dir);
  assert.equal(r.code, 1);
  assert.match(out(r), /possible private key header committed/);
});

test("patterns come from shared/secret-patterns.md, not a second copy", () => {
  const dir = repoCopy();
  rmSync(join(dir, "shared", "secret-patterns.md"));
  const r = validate(dir);
  assert.equal(r.code, 1);
  assert.match(out(r), /missing: yeet and validate both depend on this list/);
});

test("an unparseable pattern line is reported, not silently skipped", () => {
  const dir = repoCopy();
  patch(
    join(dir, "shared", "secret-patterns.md"),
    "JWT :: ",
    "JWT is broken now ",
  );
  const r = validate(dir);
  assert.equal(r.code, 1);
  assert.match(out(r), /is not "<label> :: <regex>"/);
});

test("an invalid regex in the pattern list is reported", () => {
  const dir = repoCopy();
  // `[unclosed` would still compile - the class closes on the next `]` in the
  // real pattern. An unclosed group cannot be rescued that way.
  patch(join(dir, "shared", "secret-patterns.md"), /^JWT :: .*$/m, "JWT :: ((((");
  const r = validate(dir);
  assert.equal(r.code, 1);
  assert.match(out(r), /is not a valid regex/);
});
