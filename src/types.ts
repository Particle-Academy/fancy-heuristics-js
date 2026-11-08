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

/**
 * Once-per-session acquisition/audience context — how the visitor arrived and
 * what their environment looks like, so the server can build GA-style
 * acquisition + audience reports. Captured from browser built-ins and attached
 * to the FIRST `CollectBatch` of a session only (subsequent batches omit it).
 * Every field is optional and omitted (never `null`) when unavailable.
 */
export interface SessionContext {
  /** `document.referrer` — empty string when navigated directly. */
  referrer?: string;
  /** Campaign params lifted from `location.search`; only present keys included. */
  utm?: {
    source?: string;
    medium?: string;
    campaign?: string;
    term?: string;
    content?: string;
  };
  /** `navigator.language`. */
  lang?: string;
  /** IANA timezone from `Intl.DateTimeFormat().resolvedOptions().timeZone`. */
  tz?: string;
  /** `screen.width`. */
  screenW?: number;
  /** `screen.height`. */
  screenH?: number;
  /** `window.devicePixelRatio`. */
  dpr?: number;
}

/** The batched POST body sent to `${endpoint}/collect`. */
export interface CollectBatch {
  siteKey: string;
  sessionId: string;
  events: HeuristicsEvent[];
  /**
   * Session context — present ONLY on the first batch of a session. Optional so
   * older servers (and every later batch) simply omit it.
   */
  context?: SessionContext;
}

// ── Wire v2 ────────────────────────────────────────────────────────────────

/**
 * A structured event name, `<domain>.<verb>`: `ui.view`, `ui.activate`,
 * `engage.time`, `engage.scroll`, `pointer.sample`, `agent.act`,
 * `agent.tool`, … The server accepts only registered names.
 */
export type EventName = string;

/** The v1 projection of a v2 event, so a server older than v2 still stores it. */
export type EventKindV2 = EventKind | "agent" | "custom";

/** What was activated. Every field is a handle, never free page text. */
export interface EventTarget2 {
  /** From `data-react-fancy-<component>`, e.g. "button", "streaming-audio"; "none" when unmarked. */
  component: string;
  /** From a `data-<x>-control` / `data-<x>-part` attribute, e.g. "play". */
  part?: string;
  /** `data-heuristics-id`, `data-fancy-id` or `id`, found inside the component only. */
  instance?: string;
  /** ARIA role, or the role implied by the tag, of the activated control. */
  role?: string;
  /** Accessible name of the activated control only, whitespace-normalised, ≤ 60 chars. */
  name?: string;
}

/** Host route identity, separate from the path and from the title. */
export interface RouteInfo {
  /** Host route name, e.g. "packages.show". */
  name?: string;
  /** Route pattern, e.g. "/packages/{slug}". */
  pattern?: string;
}

/** A scalar property bag, bounded by the server. */
export type EventProps = Record<string, string | number | boolean>;

export interface HeuristicsEventV2 {
  /** Unique per event; makes a replayed event harmless. */
  eventId: string;
  name: EventName;
  /** v1 projection for older servers; newer servers derive it from `name`. */
  kind: EventKindV2;
  actor: Actor;
  /** Pathname only: never the query string or fragment. */
  path: string;
  ts: number;
  route?: RouteInfo;
  /** Page title. Only on `ui.view`, ≤ 120 chars. */
  title?: string;
  target?: EventTarget2;
  props?: EventProps;
  x?: number;
  y?: number;
  vw?: number;
  vh?: number;
  scrollPct?: number;
  dwellMs?: number;
}

export interface CollectBatchV2 {
  schemaVersion: 2;
  /** Stable across retries of the same batch: the server's idempotency key. */
  batchId: string;
  siteKey: string;
  sessionId: string;
  sentAt: number;
  context?: SessionContext;
  events: HeuristicsEventV2[];
}

/**
 * Collection tiers. `essential`: only what the host emits itself (`track()`,
 * `view()`); `analytics` (default): views, activations, scroll milestones,
 * active time, agent activity; `research`: analytics plus pointer samples.
 */
export type CollectLevel = "essential" | "analytics" | "research";

/** How a host states analytics consent. Anything but an explicit grant is "denied". */
export type ConsentInput = boolean | "granted" | "denied" | (() => boolean);

/** Which signal families to capture. Omitted families follow the collect level. */
export interface TrackConfig {
  pageview?: boolean;
  dwell?: boolean;
  click?: boolean;
  scroll?: boolean;
  /** Pointer samples (heatmap). Off unless `collect: "research"` or set true here. */
  pointer?: boolean;
  /** Tap the fancy-auto-common activity bus for agent-actor events. */
  agent?: boolean;
}

export interface CollectorOptions {
  /** Identifies the site to the ingestion endpoint. */
  siteKey: string;
  /** Base URL, e.g. "https://host/heuristics". `/collect` is appended on flush. */
  endpoint: string;
  /** Collection tier. Default `"analytics"`. */
  collect?: CollectLevel;
  /** Per-signal override of the tier. */
  track?: TrackConfig;
  /**
   * Analytics consent. **Denied by default**: when omitted (or denied),
   * nothing is attached and nothing is sent until `setConsent(true)`, and a
   * development-only warning says so. Grant it with `true`, `"granted"`, or a
   * callback read at `start()` (e.g. one that asks fancy-compliance).
   */
  consent?: ConsentInput;
  /** Route name / pattern for the current location. Read on every view. */
  route?: () => RouteInfo | undefined;
  /** Page title for the current view. Default `document.title`. */
  title?: () => string | undefined;
  /** `"none"` records no accessible names at all. Default `"control"`. */
  labels?: "control" | "none";
  /** Detect single-page navigations (History / Navigation API). Default true. */
  spa?: boolean;
  /**
   * Delay before a detected navigation records its view, so the new page's
   * title has applied. Default 50 ms.
   */
  viewDelayMs?: number;
  /** Idle cut-off for active time. Default 30 000 ms. */
  idleMs?: number;
  /** How often an active-time chunk is emitted while a view stays open. Default 15 000 ms. */
  engageEmitMs?: number;
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
  /** Attach listeners + emit the initial view. Idempotent. */
  start(): void;
  /** Detach all listeners, flush remaining events, stop timers. Idempotent. */
  stop(): void;
  /** Send the buffered events now (via sendBeacon / fetch fallback). */
  flush(): void;
  /**
   * Record a view of the current location now. Call it after your router has
   * finished a navigation if automatic detection is off. A repeat for the same
   * path within 500 ms is ignored.
   */
  view(): void;
  /** Grant or withdraw analytics consent. Withdrawal drops anything unsent. */
  setConsent(granted: boolean): void;
  /** Record a named event. Unregistered names are rejected by the server. */
  track(name: EventName, fields?: { target?: EventTarget2; props?: EventProps; actor?: Actor }): void;
}
