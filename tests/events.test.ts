import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPageview,
  buildClick,
  buildScroll,
  buildPointer,
  buildDwell,
  scrollPercent,
} from "../src/events.ts";

// ── frozen wire contract: field-for-field ────────────────────────────────────
// Event = { kind, actor, path, ts, x?, y?, vw?, vh?, scrollPct?, dwellMs?,
//           targetId?, label?, meta? }

test("pageview matches contract: only kind/actor/path/ts", () => {
  const e = buildPageview("/home", 1000);
  assert.deepEqual(e, { kind: "pageview", actor: "human", path: "/home", ts: 1000 });
  assert.deepEqual(Object.keys(e).sort(), ["actor", "kind", "path", "ts"]);
});

test("click carries x/y viewport coords + vw/vh + target handle/label", () => {
  const e = buildClick({
    path: "/p",
    ts: 5,
    x: 12,
    y: 34,
    vw: 1280,
    vh: 720,
    targetId: "buy-btn",
    label: "Buy now",
  });
  assert.equal(e.kind, "click");
  assert.equal(e.actor, "human");
  assert.equal(e.path, "/p");
  assert.equal(e.ts, 5);
  assert.equal(e.x, 12);
  assert.equal(e.y, 34);
  assert.equal(e.vw, 1280);
  assert.equal(e.vh, 720);
  assert.equal(e.targetId, "buy-btn");
  assert.equal(e.label, "Buy now");
  // no stray fields
  assert.deepEqual(
    Object.keys(e).sort(),
    ["actor", "kind", "label", "path", "targetId", "ts", "vh", "vw", "x", "y"],
  );
});

test("click omits optional targetId/label/meta when not provided (no null)", () => {
  const e = buildClick({ path: "/p", ts: 1, x: 0, y: 0, vw: 10, vh: 10 });
  assert.ok(!("targetId" in e));
  assert.ok(!("label" in e));
  assert.ok(!("meta" in e));
  // every present value is defined (never null)
  for (const v of Object.values(e)) assert.notEqual(v, null);
});

test("scroll carries scrollPct only", () => {
  const e = buildScroll({ path: "/", ts: 9, scrollPct: 42 });
  assert.deepEqual(e, { kind: "scroll", actor: "human", path: "/", ts: 9, scrollPct: 42 });
});

test("pointer carries x/y/vw/vh", () => {
  const e = buildPointer({ path: "/", ts: 2, x: 1, y: 2, vw: 3, vh: 4 });
  assert.deepEqual(e, {
    kind: "pointer",
    actor: "human",
    path: "/",
    ts: 2,
    x: 1,
    y: 2,
    vw: 3,
    vh: 4,
  });
});

test("dwell carries dwellMs", () => {
  const e = buildDwell({ path: "/", ts: 3, dwellMs: 8500 });
  assert.deepEqual(e, { kind: "dwell", actor: "human", path: "/", ts: 3, dwellMs: 8500 });
});

test("actor override produces actor:agent", () => {
  const e = buildClick({ path: "/", ts: 1, x: 0, y: 0, vw: 1, vh: 1, actor: "agent" });
  assert.equal(e.actor, "agent");
});

test("event values are JSON-round-trip stable", () => {
  const e = buildClick({
    path: "/x",
    ts: 7,
    x: 1,
    y: 2,
    vw: 3,
    vh: 4,
    targetId: "t",
    label: "L",
    meta: { a: 1 },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(e)), e);
});

// ── scroll math ──────────────────────────────────────────────────────────────
test("scrollPercent: non-scrollable page reads 100", () => {
  assert.equal(scrollPercent(0, 0), 100);
  assert.equal(scrollPercent(0, -5), 100);
});

test("scrollPercent: clamps 0..100 and rounds", () => {
  assert.equal(scrollPercent(0, 1000), 0);
  assert.equal(scrollPercent(500, 1000), 50);
  assert.equal(scrollPercent(1000, 1000), 100);
  assert.equal(scrollPercent(9999, 1000), 100);
  assert.equal(scrollPercent(333, 1000), 33);
});
