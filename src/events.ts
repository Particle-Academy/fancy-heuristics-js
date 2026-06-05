/**
 * Pure event builders. Each returns a `HeuristicsEvent` matching the frozen wire
 * contract. Kept side-effect-free so they unit-test without a DOM. Optional
 * fields are omitted (never `null`) when not applicable.
 */
import type { Actor, EventKind, HeuristicsEvent } from "./types.ts";

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
