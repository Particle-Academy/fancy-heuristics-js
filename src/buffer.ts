/**
 * Event buffer + transport. Accumulates events and ships them as a single
 * `CollectBatch` to `${endpoint}/collect`. Prefers `navigator.sendBeacon`
 * (survives page unload), falling back to a keepalive `fetch`. The buffer is a
 * plain array so it unit-tests with an injected `send` spy and no network.
 */
import type { CollectBatch, HeuristicsEvent, SessionContext } from "./types.ts";

/** Pluggable transport — returns true if the batch was handed off. */
export type SendFn = (url: string, body: string) => boolean;

export interface BufferOptions {
  siteKey: string;
  endpoint: string;
  sessionId: string;
  /**
   * Once-per-session context. Attached to the FIRST batch this buffer ships,
   * then dropped so later batches stay small. Omitted when undefined.
   */
  context?: SessionContext;
  /** Transport. Defaults to sendBeacon → fetch. */
  send?: SendFn;
}

export class EventBuffer {
  private events: HeuristicsEvent[] = [];
  private readonly siteKey: string;
  private readonly url: string;
  private readonly sessionId: string;
  private readonly send: SendFn;
  /** Pending once-per-session context; cleared after the first successful send. */
  private context: SessionContext | undefined;

  constructor(opts: BufferOptions) {
    this.siteKey = opts.siteKey;
    this.url = joinCollect(opts.endpoint);
    this.sessionId = opts.sessionId;
    this.context = opts.context;
    this.send = opts.send ?? defaultSend;
  }

  /** Queue one event for the next flush. */
  add(event: HeuristicsEvent): void {
    this.events.push(event);
  }

  /** Number of buffered (un-flushed) events. */
  get size(): number {
    return this.events.length;
  }

  /** The collect URL this buffer ships to. */
  get collectUrl(): string {
    return this.url;
  }

  /**
   * Ship the buffered events as one batch. No-op when empty. On a failed
   * handoff the events are kept so the next flush retries them.
   */
  flush(): void {
    if (this.events.length === 0) return;
    const batch: CollectBatch = {
      siteKey: this.siteKey,
      sessionId: this.sessionId,
      events: this.events,
    };
    // Attach the once-per-session context to the first batch only.
    if (this.context !== undefined) batch.context = this.context;
    const body = JSON.stringify(batch);
    const ok = this.send(this.url, body);
    if (ok) {
      this.events = [];
      // Drop the context so subsequent batches stay small. Kept on failure so
      // the retry still carries it.
      this.context = undefined;
    }
  }
}

/** Append `/collect`, tolerating a trailing slash on the endpoint. */
export function joinCollect(endpoint: string): string {
  return endpoint.replace(/\/+$/, "") + "/collect";
}

/** Default transport: sendBeacon, then keepalive fetch, then drop. */
export const defaultSend: SendFn = (url, body) => {
  const nav: Navigator | undefined =
    typeof navigator !== "undefined" ? navigator : undefined;

  if (nav && typeof nav.sendBeacon === "function") {
    try {
      // sendBeacon prefers a Blob so the Content-Type is explicit.
      const blob =
        typeof Blob !== "undefined"
          ? new Blob([body], { type: "application/json" })
          : body;
      if (nav.sendBeacon(url, blob as BodyInit)) return true;
    } catch {
      /* fall through to fetch */
    }
  }

  if (typeof fetch === "function") {
    try {
      void fetch(url, {
        method: "POST",
        body,
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        // Cross-origin ingestion: the PHP routes are CSRF-exempt; we don't read
        // the response, so an opaque mode is fine.
        mode: "cors",
        credentials: "omit",
      }).catch(() => {});
      return true;
    } catch {
      return false;
    }
  }

  return false;
};
