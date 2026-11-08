import { test } from "node:test";
import assert from "node:assert/strict";
import type { CollectBatchV2, HeuristicsEventV2 } from "../src/types.ts";
import { find, showcaseHeader } from "./dom.ts";

// ── harness ───────────────────────────────────────────────────────────────────

type Listener = (e: any) => void;

class FakeTarget {
  listeners = new Map<string, Listener[]>();
  addEventListener(type: string, fn: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  removeEventListener(type: string, fn: Listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((f) => f !== fn));
  }
  fire(type: string, ev: any = {}) {
    for (const fn of this.listeners.get(type) ?? []) fn(ev);
  }
  count(type: string): number {
    return (this.listeners.get(type) ?? []).length;
  }
}

interface Harness {
  doc: any;
  win: any;
  loc: { pathname: string; search: string; href: string };
  history: any;
  sent: CollectBatchV2[];
  events(): HeuristicsEventV2[];
  failNext: { value: number };
  restore(): void;
}

function harness(path = "/", title = "Home"): Harness {
  const doc = new FakeTarget() as any;
  doc.visibilityState = "visible";
  doc.title = title;
  doc.referrer = "";
  doc.documentElement = { scrollHeight: 2000, clientHeight: 1000, scrollTop: 0 };
  doc.getElementById = () => null;

  const win = new FakeTarget() as any;
  win.innerWidth = 1280;
  win.innerHeight = 800;
  win.scrollY = 0;

  const loc = { pathname: path, search: "", href: `https://example.com${path}` };
  const history = {
    pushState(_s: unknown, _t: string, url: string) {
      loc.pathname = url;
      loc.href = `https://example.com${url}`;
    },
    replaceState(_s: unknown, _t: string, url: string) {
      loc.pathname = url;
      loc.href = `https://example.com${url}`;
    },
  };

  win.history = history;

  const sent: CollectBatchV2[] = [];
  const failNext = { value: 0 };

  const g = globalThis as any;
  const shims: Record<string, unknown> = {
    document: doc,
    window: win,
    location: loc,
    history,
    sessionStorage: memStore(),
    Blob: undefined,
    navigator: {
      sendBeacon: (_u: string, body: string) => {
        if (failNext.value > 0) {
          failNext.value--;
          return false;
        }
        sent.push(JSON.parse(body));
        return true;
      },
    },
    fetch: undefined,
    navigation: undefined,
  };
  const saved: Array<[string, PropertyDescriptor | undefined]> = [];
  for (const [k, v] of Object.entries(shims)) {
    saved.push([k, Object.getOwnPropertyDescriptor(g, k)]);
    Object.defineProperty(g, k, { value: v, configurable: true, writable: true });
  }

  return {
    doc,
    win,
    loc,
    history,
    sent,
    failNext,
    events: () => sent.flatMap((b) => b.events),
    restore() {
      // A test that throws before stop() must not leak the flush interval.
      for (const c of live.splice(0)) {
        try {
          c.stop?.();
        } catch {
          /* ignore */
        }
      }
      for (const [k, d] of saved) {
        if (d) Object.defineProperty(g, k, d);
        else delete g[k];
      }
    },
  };
}

function memStore() {
  const data: Record<string, string> = {};
  return {
    getItem: (k: string) => (k in data ? data[k]! : null),
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

const live: any[] = [];

async function collector(opts: Record<string, unknown> = {}) {
  const { createCollector } = await import("../src/collector.ts");
  const c: any = createCollector({
    siteKey: "K",
    endpoint: "https://h/heuristics",
    track: { agent: false },
    viewDelayMs: 0,
    // Consent is denied by default; these tests grant it explicitly unless a
    // test sets `consent` itself (even to undefined).
    ...("consent" in opts ? {} : { consent: "granted" }),
    ...opts,
  } as any);
  live.push(c);
  return c;
}

const named = (h: Harness, name: string) => h.events().filter((e) => e.name === name);

// ── the reported defect: mashed labels ─────────────────────────────────────────

test("clicking a react-fancy Button inside the header records that button, never the header text", async () => {
  const h = harness("/");
  try {
    const c = await collector();
    c.start();
    const header = showcaseHeader();
    const label = find(header, (el) => el.hasAttribute("data-react-fancy-button-label"));
    h.doc.fire("click", { target: label, clientX: 10, clientY: 10 });
    c.flush();

    const clicks = named(h, "ui.activate");
    assert.equal(clicks.length, 1);
    assert.deepEqual(clicks[0]!.target, { component: "button", role: "button", name: "Sign in" });
    assert.equal(clicks[0]!.kind, "click");

    const wire = JSON.stringify(h.sent);
    assert.ok(!wire.includes("Kitv0.5"), "no mashed header text anywhere on the wire");
    assert.ok(!wire.includes('"label"'), "v2 events carry no free-text label");
    c.stop();
  } finally {
    h.restore();
  }
});

// ── wire v2 ──────────────────────────────────────────────────────────────────

test("batches are wire v2: schemaVersion, batchId, sentAt, and an eventId per event", async () => {
  const h = harness("/");
  try {
    const c = await collector();
    c.start();
    c.flush();
    const batch = h.sent[0]!;
    assert.equal(batch.schemaVersion, 2);
    assert.match(batch.batchId, /.{8,}/);
    assert.equal(typeof batch.sentAt, "number");
    assert.equal(batch.siteKey, "K");
    const ids = batch.events.map((e) => e.eventId);
    assert.ok(ids.every((id) => typeof id === "string" && id.length >= 8));
    assert.equal(new Set(ids).size, ids.length);
    for (const e of batch.events) assert.match(e.name, /^[a-z]+\.[a-z-]+$/);
    c.stop();
  } finally {
    h.restore();
  }
});

test("a batch that failed to send is retried with the same batchId", async () => {
  const h = harness("/");
  try {
    const c = await collector();
    c.start();
    h.failNext.value = 1;
    c.flush(); // refused by the transport
    h.doc.fire("click", { target: null, clientX: 1, clientY: 1 });
    c.flush(); // retries the first batch, then ships the new one
    assert.equal(h.sent.length, 2);
    assert.notEqual(h.sent[0]!.batchId, h.sent[1]!.batchId);
    assert.equal(h.sent[0]!.events[0]!.name, "ui.view");
    assert.equal(h.sent[1]!.events[0]!.name, "ui.activate");
    c.stop();
  } finally {
    h.restore();
  }
});

// ── SPA pageviews, route and title ─────────────────────────────────────────────

test("single-page navigation records a pageview per route change", async () => {
  const h = harness("/a", "Page A");
  try {
    const c = await collector();
    c.start();
    await tick();

    window.history.pushState({}, "", "/b");
    document.title = "Page B"; // the new page's <Head> applies after the push
    await tick();

    window.history.replaceState({}, "", "/b"); // scroll-restore style: same URL
    await tick();

    window.history.pushState({}, "", "/c");
    document.title = "Page C";
    await tick();

    h.loc.pathname = "/a"; // back button
    document.title = "Page A";
    h.win.fire("popstate");
    await tick();

    c.flush();
    const views = named(h, "ui.view").map((e) => [e.path, e.title]);
    assert.deepEqual(views, [
      ["/a", "Page A"],
      ["/b", "Page B"],
      ["/c", "Page C"],
      ["/a", "Page A"],
    ]);
    c.stop();
  } finally {
    h.restore();
  }
});

test("manual view() records a pageview and collapses a duplicate within 500 ms", async () => {
  let clock = 1_000;
  const h = harness("/x", "X");
  try {
    const c = await collector({ now: () => clock });
    c.start();
    await tick();
    h.loc.pathname = "/y";
    c.view();
    clock += 100;
    c.view(); // same URL, 100 ms later
    c.flush();
    assert.deepEqual(named(h, "ui.view").map((e) => e.path), ["/x", "/y"]);
    c.stop();
  } finally {
    h.restore();
  }
});

test("stop() puts history.pushState back", async () => {
  const h = harness("/");
  try {
    const original = h.history.pushState;
    const c = await collector();
    c.start();
    assert.notEqual(h.history.pushState, original);
    c.stop();
    assert.equal(h.history.pushState, original);
  } finally {
    h.restore();
  }
});

test("title is captured as its own field, separate from the route name and pattern", async () => {
  const h = harness("/packages/react-fancy", "react-fancy · Packages");
  try {
    const c = await collector({
      route: () => ({ name: "packages.show", pattern: "/packages/{slug}" }),
    });
    c.start();
    await tick();
    c.flush();
    const [view] = named(h, "ui.view");
    assert.equal(view!.path, "/packages/react-fancy");
    assert.deepEqual(view!.route, { name: "packages.show", pattern: "/packages/{slug}" });
    assert.equal(view!.title, "react-fancy · Packages");
    assert.equal(view!.target, undefined);
    c.stop();
  } finally {
    h.restore();
  }
});

test("title is bounded and only sent on ui.view", async () => {
  const h = harness("/", "T".repeat(300));
  try {
    const c = await collector();
    c.start();
    await tick();
    h.doc.fire("click", { target: null, clientX: 1, clientY: 1 });
    c.flush();
    assert.equal(named(h, "ui.view")[0]!.title!.length, 120);
    assert.equal(named(h, "ui.activate")[0]!.title, undefined);
    c.stop();
  } finally {
    h.restore();
  }
});

// ── engagement ──────────────────────────────────────────────────────────────────

test("engage.time counts active time only: idle after 30 s without input stops the clock", async () => {
  let clock = 0;
  const h = harness("/read");
  try {
    const c = await collector({ now: () => clock });
    c.start();
    clock = 40_000; // no input for 40 s: only the first 30 s count
    h.win.fire("pagehide");
    const [t] = named(h, "engage.time");
    assert.equal(t!.dwellMs, 30_000);
    assert.equal(t!.path, "/read");
    c.stop();
  } finally {
    h.restore();
  }
});

test("navigation closes active time for the old route", async () => {
  let clock = 0;
  const h = harness("/one");
  try {
    const c = await collector({ now: () => clock });
    c.start();
    await tick();
    clock = 5_000;
    window.history.pushState({}, "", "/two");
    await tick();
    c.flush();
    const times = named(h, "engage.time");
    assert.equal(times.length, 1);
    assert.equal(times[0]!.path, "/one");
    assert.equal(times[0]!.dwellMs, 5_000);
    c.stop();
  } finally {
    h.restore();
  }
});

test("scroll is recorded as milestones, each once per view", async () => {
  const h = harness("/long");
  try {
    const c = await collector({ scrollThrottleMs: 0 });
    c.start();
    const scrollTo = (y: number) => {
      h.win.scrollY = y;
      h.doc.documentElement.scrollTop = y;
      h.win.fire("scroll");
    };
    scrollTo(300); // 30 %
    scrollTo(800); // 80 %
    scrollTo(800);
    scrollTo(100);
    c.flush();
    assert.deepEqual(named(h, "engage.scroll").map((e) => e.scrollPct), [25, 50, 75]);
    c.stop();
  } finally {
    h.restore();
  }
});

test("pointer samples are off by default and on in the research tier", async () => {
  for (const [opts, expected] of [[{}, 0], [{ collect: "research" }, 1]] as const) {
    const h = harness("/");
    try {
      const c = await collector({ ...opts, pointerThrottleMs: 0 });
      c.start();
      h.win.fire("pointermove", { clientX: 5, clientY: 5 });
      c.flush();
      assert.equal(named(h, "pointer.sample").length, expected);
      c.stop();
    } finally {
      h.restore();
    }
  }
});

// ── consent ──────────────────────────────────────────────────────────────────────

test("with consent denied nothing is collected or sent until it is granted, and withdrawal stops it", async () => {
  const h = harness("/");
  try {
    const c = await collector({ consent: "denied" });
    c.start();
    h.doc.fire("click", { target: null, clientX: 1, clientY: 1 });
    c.flush();
    assert.equal(h.sent.length, 0);
    assert.equal(h.doc.count("click"), 0, "no listeners before consent");

    c.setConsent(true);
    await tick();
    h.doc.fire("click", { target: null, clientX: 1, clientY: 1 });
    c.flush();
    assert.deepEqual(h.events().map((e) => e.name), ["ui.view", "ui.activate"]);

    h.doc.fire("click", { target: null, clientX: 1, clientY: 1 }); // buffered, not yet sent
    c.setConsent(false);
    c.flush();
    h.doc.fire("click", { target: null, clientX: 1, clientY: 1 });
    c.flush();
    assert.equal(h.sent.length, 1, "nothing more is sent after withdrawal");
    assert.equal(h.doc.count("click"), 0, "listeners removed on withdrawal");
    c.stop();
  } finally {
    h.restore();
  }
});

// ── consent is denied by default (owner ruling, 2026-11-08) ─────────────────────

function captureWarnings(): { messages: string[]; restore(): void } {
  const messages: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    messages.push(args.map(String).join(" "));
  };
  return { messages, restore: () => (console.warn = original) };
}

test("with no consent option nothing is collected or sent, and one development warning is logged", async () => {
  const h = harness("/");
  const w = captureWarnings();
  try {
    const c = await collector({ consent: undefined });
    c.start();
    h.doc.fire("click", { target: null, clientX: 1, clientY: 1 });
    c.flush();
    c.stop();
    assert.equal(h.sent.length, 0, "nothing sent without consent");
    assert.equal(h.doc.count("click"), 0, "no listeners without consent");
    assert.equal(w.messages.filter((m) => m.includes("consent")).length, 1, "one warning");
  } finally {
    w.restore();
    h.restore();
  }
});

test("an explicit grant collects: consent true, 'granted', or a callback returning true", async () => {
  for (const consent of [true, "granted", () => true]) {
    const h = harness("/");
    const w = captureWarnings();
    try {
      const c = await collector({ consent });
      c.start();
      c.flush();
      assert.deepEqual(h.events().map((e) => e.name), ["ui.view"], `consent ${String(consent)}`);
      assert.equal(w.messages.length, 0, "no warning when consent is given");
      c.stop();
    } finally {
      w.restore();
      h.restore();
    }
  }
});

test("a consent callback returning false collects nothing until setConsent(true)", async () => {
  const h = harness("/");
  try {
    const c = await collector({ consent: () => false });
    c.start();
    c.flush();
    assert.equal(h.sent.length, 0);
    c.setConsent(true);
    c.flush();
    assert.deepEqual(h.events().map((e) => e.name), ["ui.view"]);
    c.stop();
  } finally {
    h.restore();
  }
});
