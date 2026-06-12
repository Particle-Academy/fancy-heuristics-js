import { test } from "node:test";
import assert from "node:assert/strict";
import { buildContext, parseUtm } from "../src/context.ts";
import { EventBuffer } from "../src/buffer.ts";
import { buildPageview } from "../src/events.ts";
import type { CollectBatch, SessionContext } from "../src/types.ts";

// ── parseUtm: only present, non-empty keys ───────────────────────────────────

test("parseUtm lifts present utm_* params to terse fields", () => {
  const utm = parseUtm("?utm_source=newsletter&utm_medium=email&utm_campaign=spring");
  assert.deepEqual(utm, { source: "newsletter", medium: "email", campaign: "spring" });
});

test("parseUtm omits empty values and unrelated params", () => {
  const utm = parseUtm("?utm_source=x&utm_term=&foo=bar&utm_content=hero");
  assert.deepEqual(utm, { source: "x", content: "hero" });
});

test("parseUtm returns undefined when no utm params are present", () => {
  assert.equal(parseUtm("?ref=abc&page=2"), undefined);
  assert.equal(parseUtm(""), undefined);
  assert.equal(parseUtm(undefined), undefined);
});

// ── buildContext: shape from mocked browser built-ins ────────────────────────

test("buildContext captures referrer, utm, lang, tz, screen and dpr", () => {
  const g = globalThis as any;
  const restore = installGlobals(g, {
    document: { referrer: "https://google.com/search" },
    location: { search: "?utm_source=google&utm_medium=cpc" },
    navigator: { language: "en-GB" },
    screen: { width: 2560, height: 1440 },
    window: { devicePixelRatio: 2 },
  });
  try {
    const ctx = buildContext()!;
    assert.ok(ctx, "context built in a browser-ish context");
    assert.equal(ctx.referrer, "https://google.com/search");
    assert.deepEqual(ctx.utm, { source: "google", medium: "cpc" });
    assert.equal(ctx.lang, "en-GB");
    // tz comes from the real Intl in Node — just assert it is a non-empty string.
    assert.equal(typeof ctx.tz, "string");
    assert.ok(ctx.tz!.length > 0);
    assert.equal(ctx.screenW, 2560);
    assert.equal(ctx.screenH, 1440);
    assert.equal(ctx.dpr, 2);
  } finally {
    restore();
  }
});

test("buildContext keeps an empty referrer (direct visit) but omits absent utm", () => {
  const g = globalThis as any;
  const restore = installGlobals(g, {
    document: { referrer: "" },
    location: { search: "" },
    navigator: { language: "fr" },
    screen: { width: 1280, height: 720 },
    window: { devicePixelRatio: 1 },
  });
  try {
    const ctx = buildContext()!;
    assert.equal(ctx.referrer, "");
    assert.equal("utm" in ctx, false, "utm omitted when no campaign params");
    assert.equal(ctx.lang, "fr");
  } finally {
    restore();
  }
});

test("buildContext returns undefined in a non-browser context (no document)", () => {
  const g = globalThis as any;
  const restore = installGlobals(g, { document: undefined });
  try {
    assert.equal(buildContext(), undefined);
  } finally {
    restore();
  }
});

// ── buffer: context attaches to the FIRST batch only ─────────────────────────

test("buffer attaches context to the first batch and omits it thereafter", () => {
  const sent: string[] = [];
  const context: SessionContext = { referrer: "", lang: "en-US", screenW: 1920 };
  const buf = new EventBuffer({
    siteKey: "K",
    endpoint: "https://h/x",
    sessionId: "sess-ctx",
    context,
    send: (_url, body) => {
      sent.push(body);
      return true;
    },
  });

  buf.add(buildPageview("/a", 1));
  buf.flush();
  buf.add(buildPageview("/b", 2));
  buf.flush();

  assert.equal(sent.length, 2);
  const first = JSON.parse(sent[0]!) as CollectBatch;
  const second = JSON.parse(sent[1]!) as CollectBatch;
  assert.deepEqual(first.context, context, "first batch carries context");
  assert.equal("context" in second, false, "second batch omits context");
});

test("buffer keeps context for retry when the first send fails", () => {
  const sent: string[] = [];
  let attempts = 0;
  const context: SessionContext = { lang: "de" };
  const buf = new EventBuffer({
    siteKey: "K",
    endpoint: "https://h/x",
    sessionId: "sess-retry",
    context,
    send: (_url, body) => {
      attempts++;
      if (attempts === 1) return false; // fail the first attempt
      sent.push(body);
      return true;
    },
  });

  buf.add(buildPageview("/a", 1));
  buf.flush(); // fails — context must survive
  buf.flush(); // succeeds — context attached here
  assert.equal(sent.length, 1);
  const batch = JSON.parse(sent[0]!) as CollectBatch;
  assert.deepEqual(batch.context, context);
});

test("buffer with no context never adds the field", () => {
  const sent: string[] = [];
  const buf = new EventBuffer({
    siteKey: "K",
    endpoint: "https://h/x",
    sessionId: "sess-none",
    send: (_url, body) => {
      sent.push(body);
      return true;
    },
  });
  buf.add(buildPageview("/a", 1));
  buf.flush();
  const batch = JSON.parse(sent[0]!) as CollectBatch;
  assert.equal("context" in batch, false);
});

// ── global shim helper (mirrors collector.test.ts) ───────────────────────────

/**
 * Install global shims via defineProperty (some, like `navigator`, are
 * read-only getters in Node). Returns a restore() that puts back the originals.
 */
function installGlobals(g: any, shims: Record<string, unknown>): () => void {
  const saved: Array<[string, PropertyDescriptor | undefined]> = [];
  for (const [key, value] of Object.entries(shims)) {
    saved.push([key, Object.getOwnPropertyDescriptor(g, key)]);
    Object.defineProperty(g, key, { value, configurable: true, writable: true });
  }
  return () => {
    for (const [key, desc] of saved) {
      if (desc) Object.defineProperty(g, key, desc);
      else delete g[key];
    }
  };
}
