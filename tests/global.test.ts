import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTrack, configFromScript } from "../src/global.ts";

test("parseTrack returns undefined for null/empty", () => {
  assert.equal(parseTrack(null), undefined);
  assert.equal(parseTrack(""), undefined);
  assert.equal(parseTrack("   "), undefined);
});

test("parseTrack opts in only the listed signals", () => {
  const cfg = parseTrack("click,scroll");
  assert.deepEqual(cfg, {
    pageview: false,
    dwell: false,
    click: true,
    scroll: true,
    pointer: false,
    agent: false,
  });
});

test("parseTrack is case/space tolerant", () => {
  const cfg = parseTrack("  Pointer , AGENT ");
  assert.equal(cfg!.pointer, true);
  assert.equal(cfg!.agent, true);
  assert.equal(cfg!.click, false);
});

function fakeScript(attrs: Record<string, string | null>): any {
  return { getAttribute: (k: string) => (k in attrs ? attrs[k] : null) };
}

test("configFromScript needs both data-site and data-endpoint", () => {
  assert.equal(configFromScript(fakeScript({ "data-site": "K" })), undefined);
  assert.equal(configFromScript(fakeScript({ "data-endpoint": "https://h" })), undefined);
  assert.equal(configFromScript(null), undefined);
});

test("configFromScript reads site + endpoint (+ optional track)", () => {
  const cfg = configFromScript(
    fakeScript({ "data-site": "K", "data-endpoint": "https://h/heuristics", "data-track": "click" }),
  );
  assert.equal(cfg!.siteKey, "K");
  assert.equal(cfg!.endpoint, "https://h/heuristics");
  assert.equal(cfg!.track!.click, true);
  assert.equal(cfg!.track!.pageview, false);
});

test("configFromScript without data-track leaves track undefined (all defaults)", () => {
  const cfg = configFromScript(fakeScript({ "data-site": "K", "data-endpoint": "https://h" }));
  assert.equal(cfg!.track, undefined);
});
