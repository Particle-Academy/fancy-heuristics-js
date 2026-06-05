import { test } from "node:test";
import assert from "node:assert/strict";
import { describeTarget } from "../src/collector.ts";
import type { CollectBatch } from "../src/types.ts";

// ── describeTarget: stable handle resolution ─────────────────────────────────

function fakeEl(attrs: {
  id?: string;
  testid?: string;
  fancyId?: string;
  aria?: string;
  text?: string;
  tag?: string;
  parent?: any;
}): any {
  const map: Record<string, string | null> = {
    "data-fancy-id": attrs.fancyId ?? null,
    "data-testid": attrs.testid ?? null,
    "aria-label": attrs.aria ?? null,
  };
  return {
    id: attrs.id ?? "",
    tagName: (attrs.tag ?? "div").toUpperCase(),
    textContent: attrs.text ?? "",
    parentElement: attrs.parent ?? null,
    getAttribute: (k: string) => (k in map ? map[k] : null),
  };
}

test("describeTarget reads data-fancy-id and aria-label", () => {
  const el = fakeEl({ fancyId: "cta", aria: "Sign up", tag: "button" });
  assert.deepEqual(describeTarget(el), { id: "cta", label: "Sign up" });
});

test("describeTarget falls back to id then textContent", () => {
  const el = fakeEl({ id: "hero", text: "  Hello   world  ", tag: "a" });
  assert.deepEqual(describeTarget(el), { id: "hero", label: "Hello world" });
});

test("describeTarget walks up to the nearest identified ancestor", () => {
  const button = fakeEl({ fancyId: "buy", text: "Buy", tag: "button" });
  const span = fakeEl({ text: "Buy", tag: "span", parent: button });
  const out = describeTarget(span);
  assert.equal(out.id, "buy");
});

test("describeTarget on null returns empty", () => {
  assert.deepEqual(describeTarget(null), {});
});

test("describeTarget label-only when no id present", () => {
  const el = fakeEl({ text: "Plain", tag: "p" });
  const out = describeTarget(el);
  assert.equal(out.id, undefined);
  assert.equal(out.label, "Plain");
});

// ── collector end-to-end via a minimal DOM shim ──────────────────────────────

type Listener = (e: any) => void;

class FakeTarget {
  listeners = new Map<string, Listener[]>();
  addEventListener(type: string, fn: Listener) {
    const arr = this.listeners.get(type) ?? [];
    arr.push(fn);
    this.listeners.set(type, arr);
  }
  removeEventListener(type: string, fn: Listener) {
    const arr = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      arr.filter((f) => f !== fn),
    );
  }
  fire(type: string, ev: any) {
    for (const fn of this.listeners.get(type) ?? []) fn(ev);
  }
}

test("collector: start emits pageview; click + pointer + scroll captured; flush ships batch", async () => {
  const doc = new FakeTarget() as any;
  doc.visibilityState = "visible";
  doc.documentElement = { scrollHeight: 2000, clientHeight: 1000, scrollTop: 0 };

  const win = new FakeTarget() as any;
  win.innerWidth = 1024;
  win.innerHeight = 768;
  win.scrollY = 0;

  const sent: string[] = [];

  // Install shims on globalThis for the duration of the test. `navigator` is a
  // read-only getter in Node, so it must be redefined via defineProperty.
  const g = globalThis as any;
  const restore = installGlobals(g, {
    document: doc,
    window: win,
    location: { pathname: "/landing" },
    sessionStorage: memSessionStorage(),
    // Force the string transport path so the test can read the body synchronously.
    Blob: undefined,
    navigator: {
      sendBeacon: (_url: string, body: any) => {
        sent.push(typeof body === "string" ? body : "[blob]");
        return true;
      },
    },
  });

  try {
    const { createCollector } = await import("../src/collector.ts");
    const c = createCollector({
      siteKey: "K",
      endpoint: "https://h/heuristics",
      track: { agent: false },
      pointerThrottleMs: 0,
      scrollThrottleMs: 0,
    });
    c.start();

    // click on an element with a fancy id
    doc.fire("click", {
      target: { id: "btn", tagName: "BUTTON", textContent: "Go", getAttribute: () => null, parentElement: null },
      clientX: 100,
      clientY: 200,
    });

    // pointer move
    win.fire("pointermove", { clientX: 50, clientY: 60 });

    // scroll halfway
    win.scrollY = 500;
    doc.documentElement.scrollTop = 500;
    win.fire("scroll", {});

    c.flush();

    assert.equal(sent.length, 1);
    const batch = JSON.parse(sent[0]!) as CollectBatch;
    assert.equal(batch.siteKey, "K");
    assert.ok(batch.sessionId.length > 0);

    const kinds = batch.events.map((e) => e.kind);
    assert.ok(kinds.includes("pageview"), "pageview present");
    assert.ok(kinds.includes("click"), "click present");
    assert.ok(kinds.includes("pointer"), "pointer present");
    assert.ok(kinds.includes("scroll"), "scroll present");

    const click = batch.events.find((e) => e.kind === "click")!;
    assert.equal(click.actor, "human");
    assert.equal(click.x, 100);
    assert.equal(click.y, 200);
    assert.equal(click.vw, 1024);
    assert.equal(click.vh, 768);
    assert.equal(click.path, "/landing");

    const scroll = batch.events.find((e) => e.kind === "scroll")!;
    assert.equal(scroll.scrollPct, 50);

    c.stop();
  } finally {
    restore();
  }
});

test("collector: dwell accumulates and flushes on pagehide", async () => {
  const doc = new FakeTarget() as any;
  doc.visibilityState = "visible";
  doc.documentElement = { scrollHeight: 1000, clientHeight: 1000, scrollTop: 0 };
  const win = new FakeTarget() as any;
  win.innerWidth = 800;
  win.innerHeight = 600;

  const sent: string[] = [];
  const g = globalThis as any;
  const restore = installGlobals(g, {
    document: doc,
    window: win,
    location: { pathname: "/dwell" },
    sessionStorage: memSessionStorage(),
    Blob: undefined,
    navigator: {
      sendBeacon: (_u: string, b: any) => {
        sent.push(typeof b === "string" ? b : "[blob]");
        return true;
      },
    },
  });

  try {
    // Injected clock so the visible-time delta is measurable in a sync test.
    let clock = 1000;
    const now = () => clock;
    const { createCollector } = await import("../src/collector.ts");
    const c = createCollector({
      siteKey: "K",
      endpoint: "https://h/x",
      track: { agent: false, click: false, scroll: false, pointer: false },
      now,
    });
    c.start(); // opens dwell window at t=1000
    clock = 4200; // 3.2s of visible time elapses
    // simulate a hide/show cycle (closes the window, banking 3200ms)
    doc.visibilityState = "hidden";
    doc.fire("visibilitychange", {});
    clock = 5000; // hidden time should NOT count toward dwell
    doc.visibilityState = "visible";
    doc.fire("visibilitychange", {});
    // pagehide -> final dwell + flush
    win.fire("pagehide", {});

    assert.ok(sent.length >= 1);
    const batch = JSON.parse(sent[sent.length - 1]!) as CollectBatch;
    const dwell = batch.events.find((e) => e.kind === "dwell");
    assert.ok(dwell, "dwell event flushed on pagehide");
    assert.equal(dwell!.actor, "human");
    assert.equal(dwell!.path, "/dwell");
    // 3200ms of visible time banked; hidden gap excluded.
    assert.equal(dwell!.dwellMs, 3200);
    c.stop();
  } finally {
    restore();
  }
});

// ── global shim helpers ──────────────────────────────────────────────────────

function memSessionStorage() {
  const data: Record<string, string> = {};
  return {
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
  };
}

/**
 * Install global shims via defineProperty (some, like `navigator`, are
 * read-only getters in Node). Returns a restore() that puts back the original
 * descriptors.
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
