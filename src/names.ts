/**
 * The core event-name vocabulary, `<domain>.<verb>`. Mirrors
 * `FancyHeuristics\Support\EventNames::CORE` on the server; the server rejects
 * any name it has not registered, so a typo becomes a rejection count rather
 * than a new row in every report.
 */
import type { EventKindV2 } from "./types.ts";

export const CORE_NAMES = [
  "ui.view",
  "ui.activate",
  "ui.change",
  "ui.submit",
  "ui.open",
  "ui.close",
  "ui.copy",
  "engage.time",
  "engage.scroll",
  "pointer.sample",
  "error.js",
  "error.promise",
  "error.http",
  "error.component",
  "perf.vitals",
  "friction.rage",
  "friction.dead",
  "friction.error-click",
  "feature.used",
  "feature.denied",
  "feature.limit",
  "agent.act",
  "agent.tool",
] as const;

/**
 * The v1 `kind` a name projects to, so a server that predates v2 stores the
 * event as before. Agent names project to "agent", which such a server
 * rejects: an agent action is never recorded as a click.
 */
export function kindForName(name: string): EventKindV2 {
  switch (name) {
    case "ui.view":
      return "pageview";
    case "ui.activate":
      return "click";
    case "engage.time":
      return "dwell";
    case "engage.scroll":
      return "scroll";
    case "pointer.sample":
      return "pointer";
  }
  return name.startsWith("agent.") ? "agent" : "custom";
}
