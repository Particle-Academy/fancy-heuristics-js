/**
 * Once-per-session acquisition/audience context. Captured from browser built-ins
 * (referrer, UTM params, language, timezone, screen) so the server can build
 * GA-style acquisition + audience reports. Every access is feature-detected so
 * building the context in a non-browser context degrades to `undefined` — the
 * collector already no-ops off-browser, this just keeps the envelope clean.
 *
 * Optional fields are omitted (never `null` / `""`) when not available, keeping
 * the JSON terse — matching the Event builders' posture.
 */
import type { SessionContext } from "./types.ts";

/** The UTM keys we lift off `location.search`, mapped to the terse field names. */
const UTM_KEYS: ReadonlyArray<[param: string, field: keyof NonNullable<SessionContext["utm"]>]> = [
  ["utm_source", "source"],
  ["utm_medium", "medium"],
  ["utm_campaign", "campaign"],
  ["utm_term", "term"],
  ["utm_content", "content"],
];

/**
 * Build the session context from browser built-ins. Returns `undefined` in a
 * non-browser context (no `document`). Individual fields are omitted when their
 * source is unavailable or empty so the wire payload stays terse.
 */
export function buildContext(): SessionContext | undefined {
  if (typeof document === "undefined" || !document) return undefined;

  const ctx: SessionContext = {};

  // referrer — empty string when navigated directly; we always include it so the
  // server can distinguish "direct" (empty) from "not captured" (field absent).
  if (typeof document.referrer === "string") {
    ctx.referrer = document.referrer;
  }

  const utm = parseUtm(
    typeof location !== "undefined" && location ? location.search : undefined,
  );
  if (utm) ctx.utm = utm;

  const nav: Navigator | undefined =
    typeof navigator !== "undefined" ? navigator : undefined;
  if (nav && typeof nav.language === "string" && nav.language) {
    ctx.lang = nav.language;
  }

  const tz = resolveTimeZone();
  if (tz) ctx.tz = tz;

  const scr: Screen | undefined = typeof screen !== "undefined" ? screen : undefined;
  if (scr) {
    if (typeof scr.width === "number") ctx.screenW = scr.width;
    if (typeof scr.height === "number") ctx.screenH = scr.height;
  }

  if (typeof window !== "undefined" && typeof window.devicePixelRatio === "number") {
    ctx.dpr = window.devicePixelRatio;
  }

  return ctx;
}

/**
 * Parse `utm_*` params out of a query string (e.g. `location.search`). Only keys
 * that are present and non-empty are included; returns `undefined` when none
 * matched so the caller can omit the whole `utm` object.
 */
export function parseUtm(search: string | undefined): SessionContext["utm"] | undefined {
  if (!search || typeof URLSearchParams === "undefined") return undefined;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return undefined;
  }
  const utm: NonNullable<SessionContext["utm"]> = {};
  let found = false;
  for (const [param, field] of UTM_KEYS) {
    const raw = params.get(param);
    if (raw) {
      utm[field] = raw;
      found = true;
    }
  }
  return found ? utm : undefined;
}

/** Resolve the IANA timezone via `Intl`, guarding for environments without it. */
function resolveTimeZone(): string | undefined {
  try {
    if (typeof Intl === "undefined" || typeof Intl.DateTimeFormat !== "function") {
      return undefined;
    }
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz || undefined;
  } catch {
    return undefined;
  }
}
