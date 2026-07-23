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
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// getAgentDir is the only path helper the package re-exports from its entry point;
// getAuthPath/getSettingsPath exist in pi's config module but are NOT re-exported,
// so importing them by name is a link-time error that silently disables the splash.
// Derive both files from getAgentDir() the same way pi does internally.
import { VERSION, getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  buildSplashLines,
  formatModelLine,
  shortenPath,
  authStatusLine,
  packagesStatusLine,
  loadSplashConfig,
  HEADING_TIPS,
  HEADING_STATUS,
} from "../scripts/session-splash.mjs";
import { phaseForTick, tickIntervalMs } from "../scripts/splash/render-core.mjs";

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

// pi detects the terminal's background on first run and stores "dark" or
// "light" (or a custom theme name) as settings.theme (see pi's docs/themes.md).
// A custom theme's own light/dark-ness isn't exposed to extensions, so this
// falls back to "dark" for anything other than a literal "light" - the same
// default pi itself uses.
function wordmarkScheme(settings) {
  return settings?.theme === "light" ? "light" : "dark";
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
  // Handle for the startup shimmer's timer (below). Extension factories run
  // once per pi process, but session_start can fire again within that same
  // process (/resume, /fork, /model-switch) - session_shutdown is pi's
  // documented cleanup hook for exactly that, and stopSplashAnimation() is
  // also called defensively at the top of every session_start in case a
  // shutdown was skipped, so this timer can never leak or stack.
  //
  // The shimmer itself loops indefinitely rather than stopping after one
  // sweep - it's the first thing on screen and worth lingering on. It stops
  // as soon as the user does anything (the "input" event, which fires once
  // per submitted prompt, before skill/template expansion), which is also
  // what keeps it safe: nothing else grows the frame beneath a freshly-set
  // header, so the header can't have scrolled out of the viewport before
  // that point. Continuing to animate a header pi-tui's differential
  // renderer no longer considers "on screen" forces a full-screen
  // clear-and-redraw on every tick (see pi-tui's TUI.doRender: a change
  // above the tracked viewport top falls back to fullRender) - stopping on
  // first input sidesteps that rather than trying to detect it.
  let splashAnimationTimer;
  const stopSplashAnimation = () => {
    if (splashAnimationTimer) {
      clearInterval(splashAnimationTimer);
      splashAnimationTimer = undefined;
    }
  };
  pi.on("session_shutdown", stopSplashAnimation);
  pi.on("input", stopSplashAnimation);

  pi.on("session_start", async (_event, ctx) => {
    try {
      if (ctx.mode !== "tui") return;
      stopSplashAnimation();

      const agentDir = getAgentDir();
      const settings = readJson(join(agentDir, "settings.json"));
      if (settings?.quietStartup) return;

      const pkg = readJson(PKG_PATH);
      const auth = readJson(join(agentDir, "auth.json"));

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
        scheme: wordmarkScheme(settings),
      };

      // Dither-shimmer intro: pi's own render loop owns cursor/flicker/scroll
      // handling for a header component, so this is just an advancing phase
      // (looping every splash.config.json animation.durationMs) fed through
      // invalidate()+requestRender() on a timer. See the stopSplashAnimation
      // comment above for how/why it stops.
      const { config: splashConfig } = loadSplashConfig();
      let tick = 0;
      let header;

      ctx.ui.setHeader((tui, theme) => {
        header = {
          render(width) {
            const colorMode = theme.getColorMode?.() ?? "truecolor";
            const phase = phaseForTick(tick, splashConfig);
            const plain = buildSplashLines({ width, colorMode, ...splashData, animation: "shimmer", phase });
            return colorize(plain, theme, { title, headings, welcome });
          },
          invalidate() {},
        };

        splashAnimationTimer = setInterval(() => {
          tick++;
          header.invalidate();
          tui.requestRender();
        }, tickIntervalMs(splashConfig));

        return header;
      });
    } catch {
      // Never break startup over a splash. Built-in header stays in place.
    }
  });
}
