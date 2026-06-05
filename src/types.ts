/**
 * The frozen wire contract — mirrors `docs/fancy-pixel-and-heuristics-plan.md`
 * exactly. Do NOT add fields the PHP ingestion doesn't know about; do NOT
 * rename. The PHP `fancy-heuristics` package validates against this shape.
 */

/** What kind of interaction an Event captures. */
export type EventKind = "pageview" | "click" | "scroll" | "pointer" | "dwell";

/** Who produced the interaction — a human at the keyboard, or an embedded agent. */
export type Actor = "human" | "agent";

/**
 * A single interaction event. Optional fields are omitted (not `null`) when not
 * relevant to the `kind`, keeping the JSON terse and the PHP validation simple.
 */
export interface HeuristicsEvent {
  kind: EventKind;
  actor: Actor;
  /** location.pathname at capture time. */
  path: string;
  /** ms epoch. */
  ts: number;
  /** pointer/click x — viewport coords. */
  x?: number;
  /** pointer/click y — viewport coords. */
  y?: number;
  /** viewport width (heatmap normalisation). */
  vw?: number;
  /** viewport height (heatmap normalisation). */
  vh?: number;
  /** scroll depth 0..100. */
  scrollPct?: number;
  /** time-on-page chunk in ms. */
  dwellMs?: number;
  /** stable handle of the interaction target. */
  targetId?: string;
  /** human-friendly label for the target. */
  label?: string;
  /** free-form structured payload. */
  meta?: Record<string, unknown>;
}

/** The batched POST body sent to `${endpoint}/collect`. */
export interface CollectBatch {
  siteKey: string;
  sessionId: string;
  events: HeuristicsEvent[];
}

/** Which signal families to capture. All default to `true`. */
export interface TrackConfig {
  pageview?: boolean;
  dwell?: boolean;
  click?: boolean;
  scroll?: boolean;
  pointer?: boolean;
  /** Tap the fancy-auto-common activity bus for agent-actor events. */
  agent?: boolean;
}

export interface CollectorOptions {
  /** Identifies the site to the ingestion endpoint. */
  siteKey: string;
  /** Base URL, e.g. "https://host/heuristics". `/collect` is appended on flush. */
  endpoint: string;
  /** Per-signal opt-out. Omitted families are tracked. */
  track?: TrackConfig;
  /** Flush window in ms. Default 1500. */
  flushMs?: number;
  /** Pointer-sample throttle in ms. Default 120. */
  pointerThrottleMs?: number;
  /** Scroll-sample throttle in ms. Default 200. */
  scrollThrottleMs?: number;
  /**
   * Clock injection — defaults to `Date.now`. Primarily a test seam for dwell /
   * throttle timing; production code should leave it unset.
   */
  now?: () => number;
}

export interface Collector {
  /** Attach listeners + emit the initial pageview. Idempotent. */
  start(): void;
  /** Detach all listeners, flush remaining events, stop timers. Idempotent. */
  stop(): void;
  /** Send the buffered events now (via sendBeacon / fetch fallback). */
  flush(): void;
}
