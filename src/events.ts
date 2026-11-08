/**
 * Pure event builders. Each returns a `HeuristicsEvent` matching the frozen wire
 * contract. Kept side-effect-free so they unit-test without a DOM. Optional
 * fields are omitted (never `null`) when not applicable.
 */
import { kindForName } from "./names.ts";
import { generateSessionId } from "./session.ts";
import type { Actor, EventKind, HeuristicsEvent, HeuristicsEventV2 } from "./types.ts";

/** Maximum length of a page title on the wire. */
export const MAX_TITLE = 120;

/**
 * Build a wire-v2 event. `eventId` and the v1 `kind` projection are filled
 * in; undefined optional fields are left out, never sent as null.
 */
export function buildEvent(
  name: string,
  fields: Omit<HeuristicsEventV2, "eventId" | "name" | "kind" | "actor"> & { actor?: Actor },
): HeuristicsEventV2 {
  const e: HeuristicsEventV2 = {
    eventId: generateSessionId(),
    name,
    kind: kindForName(name),
    actor: fields.actor ?? "human",
    path: fields.path,
    ts: fields.ts,
  };
  for (const key of ["route", "title", "target", "props", "x", "y", "vw", "vh", "scrollPct", "dwellMs"] as const) {
    const v = fields[key];
    if (v !== undefined) (e as unknown as Record<string, unknown>)[key] = v;
  }
  return e;
}

/** Common fields every event carries. */
function base(kind: EventKind, actor: Actor, path: string, ts: number): HeuristicsEvent {
  return { kind, actor, path, ts };
}

export function buildPageview(path: string, ts: number, actor: Actor = "human"): HeuristicsEvent {
  return base("pageview", actor, path, ts);
}

export function buildClick(args: {
  path: string;
  ts: number;
  x: number;
  y: number;
  vw: number;
  vh: number;
  targetId?: string;
  label?: string;
  actor?: Actor;
  meta?: Record<string, unknown>;
}): HeuristicsEvent {
  const e = base("click", args.actor ?? "human", args.path, args.ts);
  e.x = args.x;
  e.y = args.y;
  e.vw = args.vw;
  e.vh = args.vh;
  if (args.targetId !== undefined) e.targetId = args.targetId;
  if (args.label !== undefined) e.label = args.label;
  if (args.meta !== undefined) e.meta = args.meta;
  return e;
}

export function buildScroll(args: {
  path: string;
  ts: number;
  scrollPct: number;
  actor?: Actor;
}): HeuristicsEvent {
  const e = base("scroll", args.actor ?? "human", args.path, args.ts);
  e.scrollPct = args.scrollPct;
  return e;
}

export function buildPointer(args: {
  path: string;
  ts: number;
  x: number;
  y: number;
  vw: number;
  vh: number;
  actor?: Actor;
}): HeuristicsEvent {
  const e = base("pointer", args.actor ?? "human", args.path, args.ts);
  e.x = args.x;
  e.y = args.y;
  e.vw = args.vw;
  e.vh = args.vh;
  return e;
}

export function buildDwell(args: {
  path: string;
  ts: number;
  dwellMs: number;
  actor?: Actor;
}): HeuristicsEvent {
  const e = base("dwell", args.actor ?? "human", args.path, args.ts);
  e.dwellMs = args.dwellMs;
  return e;
}

/**
 * Clamp a raw scroll position to an integer 0..100 percentage. `scrollable` is
 * `scrollHeight - clientHeight`; a non-scrollable page reports 100 (fully seen).
 */
export function scrollPercent(scrollTop: number, scrollable: number): number {
  if (scrollable <= 0) return 100;
  const pct = (scrollTop / scrollable) * 100;
  if (pct <= 0) return 0;
  if (pct >= 100) return 100;
  return Math.round(pct);
}
