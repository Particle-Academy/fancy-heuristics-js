/**
 * The browser collector. Emits wire-v2 events (`<domain>.<verb>` names):
 *
 *   ui.view        — once on start and once per single-page navigation, with
 *                    the route name/pattern and the page title as separate
 *                    fields
 *   ui.activate    — a click, resolved to the activated control's handles
 *                    (see target.ts), never to a container's text
 *   engage.time    — ACTIVE time per view: the tab is visible and there was
 *                    input in the last 30 s
 *   engage.scroll  — scroll milestones 25/50/75/90/100, each once per view
 *   pointer.sample — pointer heatmap samples, research tier only
 *   agent.act      — agent activity from the optional fancy-auto-common bus
 *
 * Batches ship to `${endpoint}/collect` on an interval and on `pagehide`.
 * With `consent: "denied"` nothing is attached and nothing is sent until
 * `setConsent(true)`. All DOM access is feature-detected, so calling
 * `createCollector(...).start()` outside a browser is a safe no-op.
 */
import { tapAgentActivity } from "./agent.ts";
import { EventBuffer } from "./buffer.ts";
import { buildContext } from "./context.ts";
import { MAX_TITLE, buildEvent, scrollPercent } from "./events.ts";
import { resolveSessionId } from "./session.ts";
import { resolveTarget } from "./target.ts";
import type {
  Actor,
  CollectLevel,
  ConsentInput,
  Collector,
  CollectorOptions,
  EventProps,
  EventTarget2,
  HeuristicsEventV2,
  RouteInfo,
  TrackConfig,
} from "./types.ts";

const DEFAULT_FLUSH_MS = 1500;
const DEFAULT_POINTER_THROTTLE_MS = 120;
const DEFAULT_SCROLL_THROTTLE_MS = 200;
const DEFAULT_VIEW_DELAY_MS = 50;
const DEFAULT_IDLE_MS = 30_000;
const DEFAULT_ENGAGE_EMIT_MS = 15_000;
/** Repeated view signals for the same path inside this window count once. */
const VIEW_COLLAPSE_MS = 500;
const SCROLL_MILESTONES = [25, 50, 75, 90, 100] as const;
const MAX_ROUTE = 128;

function resolveTrack(track: TrackConfig | undefined, level: CollectLevel): Required<TrackConfig> {
  const on = level !== "essential";
  return {
    pageview: track?.pageview ?? on,
    dwell: track?.dwell ?? on,
    click: track?.click ?? on,
    scroll: track?.scroll ?? on,
    pointer: track?.pointer ?? level === "research",
    agent: track?.agent ?? on,
  };
}

type RouteSignal = "push" | "replace" | "pop";

export function createCollector(opts: CollectorOptions): Collector {
  if (!opts || !opts.siteKey || !opts.endpoint) {
    throw new Error("createCollector: { siteKey, endpoint } are required");
  }
  const track = resolveTrack(opts.track, opts.collect ?? "analytics");
  const flushMs = opts.flushMs ?? DEFAULT_FLUSH_MS;
  const pointerThrottleMs = opts.pointerThrottleMs ?? DEFAULT_POINTER_THROTTLE_MS;
  const scrollThrottleMs = opts.scrollThrottleMs ?? DEFAULT_SCROLL_THROTTLE_MS;
  const viewDelayMs = opts.viewDelayMs ?? DEFAULT_VIEW_DELAY_MS;
  const idleMs = opts.idleMs ?? DEFAULT_IDLE_MS;
  const engageEmitMs = opts.engageEmitMs ?? DEFAULT_ENGAGE_EMIT_MS;
  const now: () => number = opts.now ?? (() => Date.now());

  const sessionId = resolveSessionId();
  // Once-per-session acquisition/audience context — built here so a non-browser
  // context degrades to `undefined`. Attached to the first batch only (buffer).
  const context = buildContext();
  const buffer = new EventBuffer({
    siteKey: opts.siteKey,
    endpoint: opts.endpoint,
    sessionId,
    now,
    ...(context !== undefined ? { context } : {}),
  });

  // ── lifecycle state ──────────────────────────────────────────────────────
  let started = false; // the host called start()
  let attached = false; // listeners are live (started AND consented)
  // Consent is denied unless the host grants it explicitly (owner ruling,
  // 2026-11-08). A callback is read at start().
  let consented = false;
  if (opts.consent === undefined) warnMissingConsent();
  let flushTimer: ReturnType<typeof setInterval> | undefined;
  let viewTimer: ReturnType<typeof setTimeout> | undefined;
  let agentUnsub: (() => void) | undefined;
  let teardown: Array<() => void> = [];

  // ── view state ────────────────────────────────────────────────────────────
  let viewPath: string | undefined;
  let viewAt = 0;
  let milestones = new Set<number>();
  let lastScrollAt = 0;
  let lastPointerAt = 0;

  // ── active time ───────────────────────────────────────────────────────────
  let visible = true;
  let lastTick = 0;
  let lastInputAt = 0;
  let activeMs = 0;
  let lastEngageEmit = 0;

  const path = (): string =>
    typeof location !== "undefined" && location && location.pathname ? location.pathname : "/";

  const vw = (): number => (typeof window !== "undefined" ? window.innerWidth || 0 : 0);
  const vh = (): number => (typeof window !== "undefined" ? window.innerHeight || 0 : 0);

  const isVisible = (): boolean =>
    typeof document === "undefined" || !document || document.visibilityState !== "hidden";

  const emit = (e: HeuristicsEventV2): void => {
    if (attached) buffer.add(e);
  };

  const route = (): RouteInfo | undefined => {
    if (!opts.route) return undefined;
    try {
      const r = opts.route();
      if (!r) return undefined;
      const out: RouteInfo = {};
      if (typeof r.name === "string" && r.name) out.name = r.name.slice(0, MAX_ROUTE);
      if (typeof r.pattern === "string" && r.pattern) out.pattern = r.pattern.slice(0, 255);
      return out.name || out.pattern ? out : undefined;
    } catch {
      return undefined;
    }
  };

  const title = (): string | undefined => {
    try {
      const raw = opts.title
        ? opts.title()
        : typeof document !== "undefined" && document
          ? document.title
          : undefined;
      if (typeof raw !== "string") return undefined;
      const t = raw.replace(/\s+/g, " ").trim();
      return t ? t.slice(0, MAX_TITLE) : undefined;
    } catch {
      return undefined;
    }
  };

  // ── active time ───────────────────────────────────────────────────────────
  const accountActive = (): void => {
    const t = now();
    if (visible) {
      const end = Math.min(t, lastInputAt + idleMs);
      if (end > lastTick) activeMs += end - lastTick;
    }
    lastTick = t;
  };

  const onInput = (): void => {
    accountActive();
    lastInputAt = now();
  };

  /** Emit the active time banked so far against the current view's path. */
  const closeTime = (): void => {
    accountActive();
    if (activeMs > 0 && viewPath !== undefined && track.dwell) {
      emit(buildEvent("engage.time", { path: viewPath, ts: now(), dwellMs: Math.round(activeMs) }));
    }
    activeMs = 0;
    lastEngageEmit = now();
  };

  // ── views ─────────────────────────────────────────────────────────────────
  /**
   * Record a view of the current location. `afterSignal` means a navigation
   * signal already closed the old view's time, so the short gap while the new
   * page rendered is dropped rather than credited to either page.
   */
  const emitView = (afterSignal: boolean): void => {
    const p = path();
    const t = now();
    if (p === viewPath && t - viewAt < VIEW_COLLAPSE_MS) return;

    if (afterSignal) {
      accountActive();
      activeMs = 0;
    } else {
      closeTime();
    }

    viewPath = p;
    viewAt = t;
    milestones = new Set();
    lastEngageEmit = t;

    if (track.pageview) {
      const fields: Parameters<typeof buildEvent>[1] = { path: p, ts: t };
      const r = route();
      if (r) fields.route = r;
      const ttl = title();
      if (ttl) fields.title = ttl;
      emit(buildEvent("ui.view", fields));
    }
  };

  const onRouteSignal = (kind: RouteSignal): void => {
    if (!attached) return;
    const p = path();
    // replaceState (scroll restoration) and popstate on the same path are
    // not navigations. A push to the same path is, after the collapse window.
    if (p === viewPath && kind !== "push") return;
    closeTime();
    if (viewTimer !== undefined) clearTimeout(viewTimer);
    // Deferred so the new page's <Head> has set its title.
    viewTimer = setTimeout(() => {
      viewTimer = undefined;
      if (attached) emitView(true);
    }, viewDelayMs);
  };

  // ── listeners ─────────────────────────────────────────────────────────────
  const onClick = (ev: Event): void => {
    onInput();
    const me = ev as MouseEvent;
    const target: EventTarget2 = resolveTarget(ev.target as Element | null, {
      labels: opts.labels ?? "control",
    }) ?? { component: "none" };
    emit(
      buildEvent("ui.activate", {
        path: path(),
        ts: now(),
        x: Math.round(me.clientX ?? 0),
        y: Math.round(me.clientY ?? 0),
        vw: vw(),
        vh: vh(),
        target,
      }),
    );
  };

  const onScroll = (): void => {
    onInput();
    if (!track.scroll) return;
    const t = now();
    if (t - lastScrollAt < scrollThrottleMs) return;
    lastScrollAt = t;
    const doc = typeof document !== "undefined" ? document.documentElement : undefined;
    if (!doc) return;
    const scrollTop = (typeof window !== "undefined" ? window.scrollY : 0) || doc.scrollTop || 0;
    const pct = scrollPercent(scrollTop, doc.scrollHeight - doc.clientHeight);
    for (const m of SCROLL_MILESTONES) {
      if (pct >= m && !milestones.has(m)) {
        milestones.add(m);
        emit(buildEvent("engage.scroll", { path: path(), ts: t, scrollPct: m }));
      }
    }
  };

  const onPointerMove = (ev: Event): void => {
    const t = now();
    if (t - lastInputAt > 1000) onInput();
    if (!track.pointer) return;
    if (t - lastPointerAt < pointerThrottleMs) return;
    lastPointerAt = t;
    const pe = ev as PointerEvent;
    emit(
      buildEvent("pointer.sample", {
        path: path(),
        ts: t,
        x: Math.round(pe.clientX ?? 0),
        y: Math.round(pe.clientY ?? 0),
        vw: vw(),
        vh: vh(),
      }),
    );
  };

  const onVisibilityChange = (): void => {
    accountActive();
    const next = isVisible();
    if (visible && !next) {
      visible = next;
      closeTime();
    } else if (!visible && next) {
      visible = next;
      lastTick = now();
      lastInputAt = now(); // returning to the tab is input
    }
  };

  const onPageHide = (): void => {
    closeTime();
    buffer.flush();
  };

  const addListener = (
    target: EventTarget | undefined | null,
    type: string,
    handler: EventListener,
    options?: AddEventListenerOptions,
  ): void => {
    if (!target || typeof target.addEventListener !== "function") return;
    target.addEventListener(type, handler, options);
    teardown.push(() => target.removeEventListener(type, handler, options));
  };

  /** Wrap history.pushState / replaceState once; undone on detach. */
  const wrapHistory = (): void => {
    const h: History | undefined = typeof history !== "undefined" ? history : undefined;
    if (!h) return;
    for (const [method, kind] of [
      ["pushState", "push"],
      ["replaceState", "replace"],
    ] as const) {
      const original = h[method];
      if (typeof original !== "function") continue;
      const wrapped = function (this: History, ...args: Parameters<History["pushState"]>) {
        const result = original.apply(this, args);
        try {
          onRouteSignal(kind);
        } catch {
          /* never break the host's router */
        }
        return result;
      };
      h[method] = wrapped;
      teardown.push(() => {
        // Only put it back if nobody wrapped it after us.
        if (h[method] === wrapped) h[method] = original;
      });
    }
  };

  // ── attach / detach ─────────────────────────────────────────────────────────
  const attach = (): void => {
    if (attached) return;
    attached = true;

    const doc = typeof document !== "undefined" ? document : undefined;
    const win = typeof window !== "undefined" ? window : undefined;

    visible = isVisible();
    lastTick = now();
    lastInputAt = now();
    activeMs = 0;
    viewPath = undefined;

    emitView(false);

    if (track.dwell) {
      addListener(doc, "visibilitychange", onVisibilityChange as EventListener);
      addListener(win, "keydown", onInput as EventListener, { passive: true });
      addListener(win, "pointerdown", onInput as EventListener, { passive: true });
      addListener(win, "touchstart", onInput as EventListener, { passive: true });
    }
    if (track.click) {
      // ONE delegated capture-phase listener on the document.
      addListener(doc, "click", onClick, { capture: true, passive: true });
    }
    if (track.scroll || track.dwell) {
      addListener(win, "scroll", onScroll, { passive: true });
    }
    if (track.pointer || track.dwell) {
      addListener(win, "pointermove", onPointerMove, { passive: true });
    }
    addListener(win, "pagehide", onPageHide);

    if (opts.spa !== false) {
      wrapHistory();
      addListener(win, "popstate", () => onRouteSignal("pop"));
      // Inertia announces every completed visit on the document.
      addListener(doc, "inertia:navigate", () => onRouteSignal("pop"));
      const nav = (globalThis as { navigation?: EventTarget }).navigation;
      addListener(nav, "navigatesuccess", () => onRouteSignal("pop"));
    }

    if (track.agent) {
      void tapAgentActivity({ path, emit }).then((unsub) => {
        if (attached) agentUnsub = unsub;
        else unsub();
      });
    }

    if (typeof setInterval === "function") {
      flushTimer = setInterval(() => {
        accountActive();
        if (now() - lastEngageEmit >= engageEmitMs) closeTime();
        buffer.flush();
      }, flushMs);
    }
  };

  const detach = (): void => {
    if (!attached) return;
    if (flushTimer !== undefined) {
      clearInterval(flushTimer);
      flushTimer = undefined;
    }
    if (viewTimer !== undefined) {
      clearTimeout(viewTimer);
      viewTimer = undefined;
    }
    for (const fn of teardown.splice(0)) {
      try {
        fn();
      } catch {
        /* ignore */
      }
    }
    teardown = [];
    if (agentUnsub) {
      try {
        agentUnsub();
      } catch {
        /* ignore */
      }
      agentUnsub = undefined;
    }
    attached = false;
  };

  return {
    start(): void {
      if (started) return;
      started = true;
      if (!consented) consented = isGranted(opts.consent);
      if (consented) attach();
    },

    stop(): void {
      if (!started) return;
      started = false;
      if (attached) {
        closeTime();
        detach();
        buffer.flush();
      }
    },

    flush(): void {
      buffer.flush();
    },

    view(): void {
      if (attached) emitView(false);
    },

    setConsent(granted: boolean): void {
      consented = granted;
      if (granted) {
        if (started) attach();
        return;
      }
      // Withdrawn: stop at once and send nothing more, not even what is buffered.
      detach();
      buffer.clear();
    },

    track(name: string, fields: { target?: EventTarget2; props?: EventProps; actor?: Actor } = {}): void {
      const f: Parameters<typeof buildEvent>[1] = { path: path(), ts: now() };
      if (fields.target) f.target = fields.target;
      if (fields.props) f.props = fields.props;
      if (fields.actor) f.actor = fields.actor;
      emit(buildEvent(name, f));
    },
  };
}

/** True only for an explicit grant. A throwing callback is a denial. */
function isGranted(consent: ConsentInput | undefined): boolean {
  if (consent === true || consent === "granted") return true;
  if (typeof consent === "function") {
    try {
      return consent() === true;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Development only. Where `process.env` exists (a bundler, Node), anything but
 * NODE_ENV=production is development. A plain <script> page has no `process`,
 * and counts as development on localhost and *.test / *.local hosts.
 */
function isDevelopment(): boolean {
  const env = (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process?.env;
  if (env && typeof env === "object") return env.NODE_ENV !== "production";
  const host = typeof location !== "undefined" && location ? location.hostname : undefined;
  if (typeof host !== "string") return false;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".test") || host.endsWith(".local");
}

function warnMissingConsent(): void {
  if (!isDevelopment()) return;
  try {
    console.warn(
      "[fancy-heuristics] No `consent` option was given, so nothing will be collected. " +
        "Pass `consent: true` or a consent callback, or wire fancy-compliance and call setConsent().",
    );
  } catch {
    /* no console */
  }
}

/**
 * @deprecated Use {@link resolveTarget}. Kept for 0.3 callers: returns the
 * resolved instance as `id` and the activated control's accessible name as
 * `label`. It no longer climbs to a container or reads a container's text.
 */
export function describeTarget(el: Element | null): { id?: string; label?: string } {
  const t = resolveTarget(el);
  const out: { id?: string; label?: string } = {};
  if (t?.instance !== undefined) out.id = t.instance;
  if (t?.name !== undefined) out.label = t.name;
  return out;
}
