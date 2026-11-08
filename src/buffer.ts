/**
 * Event buffer + transport. Accumulates events and ships them as one wire-v2
 * `CollectBatchV2` to `${endpoint}/collect`. Prefers `navigator.sendBeacon`
 * (survives page unload), falling back to a keepalive `fetch`. The buffer is a
 * plain array so it unit-tests with an injected `send` spy and no network.
 *
 * A batch that the transport refuses is kept AS IS, with its `batchId`, and
 * retried before anything newer. The server uses `batchId` as the idempotency
 * key, so a retry that did reach it the first time is not stored twice.
 */
import { generateSessionId } from "./session.ts";
import type { CollectBatchV2, HeuristicsEventV2, SessionContext } from "./types.ts";

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
  /** Clock for `sentAt`. Defaults to `Date.now`. */
  now?: () => number;
}

export class EventBuffer {
  private events: HeuristicsEventV2[] = [];
  private pending: CollectBatchV2 | undefined;
  private readonly siteKey: string;
  private readonly url: string;
  private readonly sessionId: string;
  private readonly send: SendFn;
  private readonly now: () => number;
  /** Pending once-per-session context; cleared once a batch carrying it is sent. */
  private context: SessionContext | undefined;

  constructor(opts: BufferOptions) {
    this.siteKey = opts.siteKey;
    this.url = joinCollect(opts.endpoint);
    this.sessionId = opts.sessionId;
    this.context = opts.context;
    this.send = opts.send ?? defaultSend;
    this.now = opts.now ?? (() => Date.now());
  }

  /** Queue one event for the next flush. */
  add(event: HeuristicsEventV2): void {
    this.events.push(event);
  }

  /** Number of unsent events, including a batch awaiting retry. */
  get size(): number {
    return this.events.length + (this.pending?.events.length ?? 0);
  }

  /** The collect URL this buffer ships to. */
  get collectUrl(): string {
    return this.url;
  }

  /** Drop everything unsent (consent withdrawn). */
  clear(): void {
    this.events = [];
    this.pending = undefined;
  }

  /**
   * Ship a batch awaiting retry, then the queued events as a new batch. No-op
   * when empty. A refused batch is kept, unchanged, for the next flush.
   */
  flush(): void {
    if (this.pending) {
      if (!this.ship(this.pending)) return;
      this.pending = undefined;
    }
    if (this.events.length === 0) return;

    const batch: CollectBatchV2 = {
      schemaVersion: 2,
      batchId: generateSessionId(),
      siteKey: this.siteKey,
      sessionId: this.sessionId,
      sentAt: this.now(),
      events: this.events,
    };
    if (this.context !== undefined) {
      batch.context = this.context;
      this.context = undefined;
    }
    this.events = [];

    if (!this.ship(batch)) this.pending = batch;
  }

  private ship(batch: CollectBatchV2): boolean {
    try {
      return this.send(this.url, JSON.stringify(batch));
    } catch {
      return false;
    }
  }
}

/**
 * Append `/collect`, tolerating a trailing slash on the endpoint.
 *
 * Trimmed by index rather than `replace(/\/+$/, "")`. That pattern is a
 * polynomial-ReDoS shape (CodeQL `js/polynomial-redos`, high): the engine
 * retries `\/+$` from every position, so an endpoint of many slashes that does
 * not end in one costs O(n²). The endpoint is library input — a host passes it
 * in — so it is not automatically trustworthy, and this runs on the browser's
 * main thread where a stall is user-visible.
 *
 * The loop is O(n), allocates nothing, and needs no regex engine.
 */
export function joinCollect(endpoint: string): string {
  const SLASH = 47; // '/'
  let end = endpoint.length;
  while (end > 0 && endpoint.charCodeAt(end - 1) === SLASH) end--;

  return endpoint.slice(0, end) + "/collect";
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
