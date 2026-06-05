/**
 * The browser collector. Wires DOM listeners (click delegation, scroll depth,
 * pointer heatmap, dwell via visibility), batches the resulting Events, and
 * ships them to `${endpoint}/collect` on an interval + on `pagehide`. Also taps
 * the optional agent activity bus. All DOM access is feature-detected so calling
 * `createCollector(...).start()` in a non-browser context is a safe no-op.
 */
import { tapAgentActivity } from "./agent.ts";
import { EventBuffer } from "./buffer.ts";
import {
  buildClick,
  buildDwell,
  buildPageview,
  buildPointer,
  buildScroll,
  scrollPercent,
} from "./events.ts";
import { resolveSessionId } from "./session.ts";
import type { Collector, CollectorOptions, HeuristicsEvent, TrackConfig } from "./types.ts";

const DEFAULT_FLUSH_MS = 1500;
const DEFAULT_POINTER_THROTTLE_MS = 120;
const DEFAULT_SCROLL_THROTTLE_MS = 200;

function resolveTrack(track: TrackConfig | undefined): Required<TrackConfig> {
  return {
    pageview: track?.pageview ?? true,
    dwell: track?.dwell ?? true,
    click: track?.click ?? true,
    scroll: track?.scroll ?? true,
    pointer: track?.pointer ?? true,
    agent: track?.agent ?? true,
  };
}

export function createCollector(opts: CollectorOptions): Collector {
  if (!opts || !opts.siteKey || !opts.endpoint) {
    throw new Error("createCollector: { siteKey, endpoint } are required");
  }
  const track = resolveTrack(opts.track);
  const flushMs = opts.flushMs ?? DEFAULT_FLUSH_MS;
  const pointerThrottleMs = opts.pointerThrottleMs ?? DEFAULT_POINTER_THROTTLE_MS;
  const scrollThrottleMs = opts.scrollThrottleMs ?? DEFAULT_SCROLL_THROTTLE_MS;

  const sessionId = resolveSessionId();
  const buffer = new EventBuffer({
    siteKey: opts.siteKey,
    endpoint: opts.endpoint,
    sessionId,
  });

  // ── runtime state ──────────────────────────────────────────────────────────
  let started = false;
  let flushTimer: ReturnType<typeof setInterval> | undefined;
  let agentUnsub: (() => void) | undefined;
  const teardown: Array<() => void> = [];

  // dwell accounting
  let visibleSince = 0;
  let accumulatedDwell = 0;

  // scroll depth (monotonic max)
  let maxScrollPct = 0;
  let lastScrollAt = 0;

  // pointer throttle
  let lastPointerAt = 0;

  const path = (): string =>
    typeof location !== "undefined" && location ? location.pathname : "/";

  const now: () => number = opts.now ?? (() => Date.now());

  const vw = (): number =>
    typeof window !== "undefined" ? window.innerWidth || 0 : 0;
  const vh = (): number =>
    typeof window !== "undefined" ? window.innerHeight || 0 : 0;

  const emit = (e: HeuristicsEvent): void => buffer.add(e);

  // ── click delegation (single capture-phase listener) ────────────────────────
  const onClick = (ev: Event): void => {
    const me = ev as MouseEvent;
    const targetEl = ev.target as Element | null;
    const { id, label } = describeTarget(targetEl);
    emit(
      buildClick({
        path: path(),
        ts: now(),
        x: Math.round(me.clientX ?? 0),
        y: Math.round(me.clientY ?? 0),
        vw: vw(),
        vh: vh(),
        targetId: id,
        label,
      }),
    );
  };

  // ── scroll depth (throttled, passive) ───────────────────────────────────────
  const onScroll = (): void => {
    const t = now();
    if (t - lastScrollAt < scrollThrottleMs) return;
    lastScrollAt = t;
    const doc =
      typeof document !== "undefined" ? document.documentElement : undefined;
    if (!doc) return;
    const scrollTop =
      (typeof window !== "undefined" ? window.scrollY : 0) || doc.scrollTop || 0;
    const scrollable = doc.scrollHeight - doc.clientHeight;
    const pct = scrollPercent(scrollTop, scrollable);
    if (pct > maxScrollPct) {
      maxScrollPct = pct;
      emit(buildScroll({ path: path(), ts: t, scrollPct: maxScrollPct }));
    }
  };

  // ── pointer heatmap (throttled, passive) ────────────────────────────────────
  const onPointerMove = (ev: Event): void => {
    const t = now();
    if (t - lastPointerAt < pointerThrottleMs) return;
    lastPointerAt = t;
    const pe = ev as PointerEvent;
    emit(
      buildPointer({
        path: path(),
        ts: t,
        x: Math.round(pe.clientX ?? 0),
        y: Math.round(pe.clientY ?? 0),
        vw: vw(),
        vh: vh(),
      }),
    );
  };

  // ── dwell (visible-time accounting) ─────────────────────────────────────────
  const isVisible = (): boolean =>
    typeof document === "undefined" || document.visibilityState !== "hidden";

  const openDwellWindow = (): void => {
    if (visibleSince === 0) visibleSince = now();
  };

  const closeDwellWindow = (): void => {
    if (visibleSince !== 0) {
      accumulatedDwell += now() - visibleSince;
      visibleSince = 0;
    }
  };

  const onVisibilityChange = (): void => {
    if (isVisible()) openDwellWindow();
    else closeDwellWindow();
  };

  const emitDwell = (): void => {
    closeDwellWindow();
    if (accumulatedDwell > 0) {
      emit(buildDwell({ path: path(), ts: now(), dwellMs: accumulatedDwell }));
      accumulatedDwell = 0;
    }
    // reopen for any time after this flush (until real teardown)
    if (isVisible()) openDwellWindow();
  };

  // ── pagehide → final dwell + flush ──────────────────────────────────────────
  const onPageHide = (): void => {
    if (track.dwell) {
      closeDwellWindow();
      if (accumulatedDwell > 0) {
        emit(buildDwell({ path: path(), ts: now(), dwellMs: accumulatedDwell }));
        accumulatedDwell = 0;
      }
    }
    buffer.flush();
  };

  const addListener = (
    target: EventTarget | undefined,
    type: string,
    handler: EventListener,
    options?: AddEventListenerOptions,
  ): void => {
    if (!target || typeof target.addEventListener !== "function") return;
    target.addEventListener(type, handler, options);
    teardown.push(() => target.removeEventListener(type, handler, options));
  };

  return {
    start(): void {
      if (started) return;
      started = true;

      const doc = typeof document !== "undefined" ? document : undefined;
      const win = typeof window !== "undefined" ? window : undefined;

      if (track.pageview) {
        emit(buildPageview(path(), now()));
      }

      if (track.dwell) {
        openDwellWindow();
        addListener(doc, "visibilitychange", onVisibilityChange as EventListener);
      }

      if (track.click) {
        // ONE delegated capture-phase listener on the document.
        addListener(doc, "click", onClick, { capture: true, passive: true });
      }

      if (track.scroll) {
        addListener(win, "scroll", onScroll, { passive: true });
      }

      if (track.pointer) {
        addListener(win, "pointermove", onPointerMove, { passive: true });
      }

      // pagehide is the reliable unload signal; flush + final dwell there.
      addListener(win, "pagehide", onPageHide);

      if (track.agent) {
        void tapAgentActivity({ path, emit }).then((unsub) => {
          if (started) agentUnsub = unsub;
          else unsub();
        });
      }

      // periodic flush (also rolls up an interim dwell chunk)
      if (typeof setInterval === "function") {
        flushTimer = setInterval(() => {
          if (track.dwell) emitDwell();
          buffer.flush();
        }, flushMs);
      }
    },

    stop(): void {
      if (!started) return;
      started = false;
      if (flushTimer !== undefined) {
        clearInterval(flushTimer);
        flushTimer = undefined;
      }
      for (const fn of teardown.splice(0)) {
        try {
          fn();
        } catch {
          /* ignore */
        }
      }
      if (agentUnsub) {
        try {
          agentUnsub();
        } catch {
          /* ignore */
        }
        agentUnsub = undefined;
      }
      if (track.dwell) {
        closeDwellWindow();
        if (accumulatedDwell > 0) {
          emit(buildDwell({ path: path(), ts: now(), dwellMs: accumulatedDwell }));
          accumulatedDwell = 0;
        }
      }
      buffer.flush();
    },

    flush(): void {
      buffer.flush();
    },
  };
}

/**
 * Derive a stable handle + human label for a clicked element. Walks up to the
 * nearest element carrying an id / data-fancy-id / data-testid so nested spans
 * inside a button still resolve to the button's identity.
 */
export function describeTarget(el: Element | null): { id?: string; label?: string } {
  if (!el) return {};
  let node: Element | null = el;
  let id: string | undefined;
  for (let depth = 0; node && depth < 5; depth++) {
    const candidate =
      node.getAttribute?.("data-fancy-id") ??
      node.getAttribute?.("data-testid") ??
      (node.id || undefined);
    if (candidate) {
      id = candidate;
      break;
    }
    node = node.parentElement;
  }
  const labelSource = (node ?? el) as Element;
  const label = readLabel(labelSource);
  const out: { id?: string; label?: string } = {};
  if (id !== undefined) out.id = id;
  if (label !== undefined) out.label = label;
  return out;
}

function readLabel(el: Element): string | undefined {
  const aria = el.getAttribute?.("aria-label");
  if (aria) return trim(aria);
  const text = (el as HTMLElement).textContent;
  if (text) {
    const t = trim(text);
    if (t) return t;
  }
  const tag = el.tagName ? el.tagName.toLowerCase() : undefined;
  return tag;
}

function trim(s: string): string {
  return s.replace(/\s+/g, " ").trim().slice(0, 120);
}
