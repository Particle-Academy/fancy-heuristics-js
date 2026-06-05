/**
 * IIFE global entry — bundled to `dist/fancy-heuristics.global.min.js` and
 * exposed as `window.FancyHeuristics`. Auto-initialises a collector by reading
 * `data-site` / `data-endpoint` / `data-track` off its own <script> element:
 *
 *   <script src=".../fancy-heuristics.global.min.js"
 *           data-site="KEY"
 *           data-endpoint="https://host/heuristics"
 *           data-track="pageview,click,scroll,pointer,dwell,agent"></script>
 *
 * Programmatic use is also exposed: `FancyHeuristics.createCollector({...})`.
 * Auto-init is skipped when `data-site`/`data-endpoint` are absent so the global
 * can be loaded purely for its API.
 */
import { createCollector } from "./collector.ts";
import type { Collector, CollectorOptions, TrackConfig } from "./types.ts";

const ALL_SIGNALS = ["pageview", "dwell", "click", "scroll", "pointer", "agent"] as const;
type Signal = (typeof ALL_SIGNALS)[number];

/** Parse a comma list ("click,scroll") into a TrackConfig opt-in set. */
export function parseTrack(raw: string | null | undefined): TrackConfig | undefined {
  if (raw == null) return undefined;
  const wanted = new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  if (wanted.size === 0) return undefined;
  const cfg: TrackConfig = {};
  for (const sig of ALL_SIGNALS) {
    cfg[sig as Signal] = wanted.has(sig);
  }
  return cfg;
}

/** Find the <script> that loaded this bundle, to read its data-* attributes. */
function currentScript(): HTMLScriptElement | null {
  if (typeof document === "undefined") return null;
  const cur = document.currentScript as HTMLScriptElement | null;
  if (cur) return cur;
  // Fallback: last script that references our filename.
  const scripts = document.getElementsByTagName("script");
  for (let i = scripts.length - 1; i >= 0; i--) {
    const src = scripts[i]?.src ?? "";
    if (src.indexOf("fancy-heuristics") !== -1) return scripts[i] as HTMLScriptElement;
  }
  return null;
}

/** Read config from a <script data-*> element. */
export function configFromScript(el: HTMLScriptElement | null): CollectorOptions | undefined {
  if (!el) return undefined;
  const siteKey = el.getAttribute("data-site");
  const endpoint = el.getAttribute("data-endpoint");
  if (!siteKey || !endpoint) return undefined;
  const track = parseTrack(el.getAttribute("data-track"));
  return track ? { siteKey, endpoint, track } : { siteKey, endpoint };
}

let auto: Collector | undefined;

function autoInit(): void {
  const cfg = configFromScript(currentScript());
  if (!cfg) return;
  try {
    auto = createCollector(cfg);
    const start = (): void => auto?.start();
    if (typeof document !== "undefined" && document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
      start();
    }
  } catch {
    /* never break the host page */
  }
}

// Run on load (currentScript is only valid during initial execution).
autoInit();

export { createCollector };
export type { Collector, CollectorOptions, TrackConfig };

/** The auto-initialised collector, if `data-site`/`data-endpoint` were present. */
export function getAutoCollector(): Collector | undefined {
  return auto;
}
