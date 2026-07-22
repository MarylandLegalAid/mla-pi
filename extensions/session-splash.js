// Startup splash: replaces pi's built-in header with one oriented to this
// package's workflow (identity, model, setup status, the four skill commands).
//
// This runs for every staff member on every `pi` launch, so it must never
// break startup - the whole handler body is one try/catch, and on any
// failure it just leaves pi's built-in header in place.
//
// The layout/formatting logic lives in ../scripts/session-splash.mjs, kept
// plain-text and unit-tested there. Everything here is the impure glue: reading
// the machine, then coloring the plain-text result afterward (ANSI codes are
// zero-width, so coloring after layout never disturbs the padding computed
// there).

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { VERSION, getAuthPath, getSettingsPath } from "@earendil-works/pi-coding-agent";
import {
  buildSplashLines,
  formatModelLine,
  shortenPath,
  authStatusLine,
  packagesStatusLine,
  HEADING_TIPS,
  HEADING_STATUS,
} from "../scripts/session-splash.mjs";

const PKG_PATH = fileURLToPath(new URL("../package.json", import.meta.url));

// Same three companion packages doctor.mjs checks for.
const REQUIRED_PACKAGES = ["pi-subagents", "@juicesharp/rpiv-ask-user-question", "pi-web-access"];

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function gitConfig(key, cwd) {
  try {
    return execFileSync("git", ["config", key], { cwd, encoding: "utf8", timeout: 3000 }).trim();
  } catch {
    return "";
  }
}

function hasOpenRouterKey(auth) {
  return Boolean(process.env.OPENROUTER_API_KEY) || Boolean(auth?.openrouter?.key);
}

function findMissingPackages(settings) {
  const packages = Array.isArray(settings?.packages) ? settings.packages : [];
  return REQUIRED_PACKAGES.filter(
    (name) => !packages.some((p) => typeof p === "string" && p.includes(name)),
  );
}

/** Color specific known text runs, then all box-drawing characters. ANSI-safe: every replace targets an exact substring, so it never disturbs the padding already computed in buildSplashLines. */
function colorize(lines, theme, { title, headings, welcome }) {
  return lines.map((line) => {
    let out = line;
    if (out.includes(title)) out = out.replace(title, theme.fg("accent", title));
    for (const h of headings) {
      if (out.includes(h)) out = out.replace(h, theme.fg("accent", h));
    }
    if (out.includes(welcome)) out = out.replace(welcome, theme.bold(welcome));
    out = out.replace(/[┌┐└┘│─]/g, (ch) => theme.fg("border", ch));
    return out;
  });
}

export default function (pi) {
  pi.on("session_start", async (_event, ctx) => {
    try {
      if (ctx.mode !== "tui") return;

      const settings = readJson(getSettingsPath());
      if (settings?.quietStartup) return;

      const pkg = readJson(PKG_PATH);
      const auth = readJson(getAuthPath());

      const name = gitConfig("user.name", ctx.cwd);
      const model = ctx.model;
      let thinkingLevel;
      try {
        thinkingLevel = pi.getThinkingLevel();
      } catch {
        thinkingLevel = undefined;
      }

      const title = `pi4MLA v${pkg?.version ?? "?"} · pi ${VERSION}`;
      const welcome = name ? `Welcome back, ${name}!` : "Welcome!";
      const headings = [HEADING_TIPS, HEADING_STATUS];
      const splashData = {
        pkgVersion: pkg?.version ?? "?",
        piVersion: VERSION,
        welcomeName: name || undefined,
        modelLine: formatModelLine({ name: model?.name, thinkingLevel }),
        cwdLine: shortenPath(ctx.cwd, homedir()),
        status: [
          authStatusLine({ hasKey: hasOpenRouterKey(auth) }),
          packagesStatusLine({ missing: findMissingPackages(settings) }),
        ],
      };

      ctx.ui.setHeader((_tui, theme) => ({
        render(width) {
          const colorMode = theme.getColorMode?.() ?? "truecolor";
          const plain = buildSplashLines({ width, colorMode, ...splashData });
          return colorize(plain, theme, { title, headings, welcome });
        },
        invalidate() {},
      }));
    } catch {
      // Never break startup over a splash. Built-in header stays in place.
    }
  });
}
