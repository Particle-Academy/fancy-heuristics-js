import { test } from "node:test";
import assert from "node:assert/strict";
import { describeTarget } from "../src/collector.ts";
import { h, showcaseHeader, find } from "./dom.ts";

// describeTarget is the deprecated 0.3 surface, now a thin wrapper over
// resolveTarget: `id` is the resolved instance, `label` the activated
// control's accessible name. End-to-end collector behaviour lives in
// v2.test.ts; target resolution in target.test.ts.

test("describeTarget reads data-fancy-id and aria-label from the control", () => {
  const el = h("button", { "data-fancy-id": "cta", "aria-label": "Sign up" }, "x");
  assert.deepEqual(describeTarget(el as unknown as Element), { id: "cta", label: "Sign up" });
});

test("describeTarget reads id and the control's own normalised text", () => {
  const el = h("a", { id: "hero", href: "/" }, "  Hello   world  ");
  assert.deepEqual(describeTarget(el as unknown as Element), { id: "hero", label: "Hello world" });
});

test("describeTarget resolves a span inside a button to the button", () => {
  const button = h("button", { "data-fancy-id": "buy" }, h("span", {}, "Buy"));
  const span = button.children[0]!;
  assert.deepEqual(describeTarget(span as unknown as Element), { id: "buy", label: "Buy" });
});

test("describeTarget on null returns empty", () => {
  assert.deepEqual(describeTarget(null), {});
});

test("describeTarget no longer labels a click with a container's text", () => {
  const header = showcaseHeader();
  const p = find(header, (el) => el.tagName === "KBD");
  assert.deepEqual(describeTarget(p as unknown as Element), {});
});
