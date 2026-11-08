import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveTarget } from "../src/target.ts";
import { byText, find, h, showcaseHeader, streamingAudio } from "./dom.ts";

/** The exact label stored 24 times in the showcase DB (plan section 1.1). */
const MASHED =
  "Fancy UI Kitv0.5DocsLearnPackagesFeaturesUse CasesInspirationShowcaseLeaderboardCtrlKSign inDocsPackagesFeaturesMoreSign";

test("a react-fancy Button inside the header resolves to that button, never the header text", () => {
  const header = showcaseHeader();
  // Sanity: the fixture reproduces the stored string.
  assert.equal(header.textContent.slice(0, 120), MASHED);

  const label = find(header, (el) => el.hasAttribute("data-react-fancy-button-label"));
  const t = resolveTarget(label as unknown as Element);

  assert.deepEqual(t, { component: "button", role: "button", name: "Sign in" });
});

test("a header nav link resolves to the link's own text", () => {
  const header = showcaseHeader();
  const span = find(header, (el) => el.parentElement?.tagName === "A" && el.textContent === "Docs");
  const t = resolveTarget(span as unknown as Element);
  assert.deepEqual(t, { component: "none", role: "link", name: "Docs" });

  // The mobile menu's plain "Docs" text is not a control: no name is invented.
  assert.deepEqual(resolveTarget(byText(header, "Docs") as unknown as Element), { component: "none" });
});

test("StreamingAudio Play resolves to component, part, instance and accessible name", () => {
  const player = streamingAudio();
  const icon = find(player, (el) => el.hasAttribute("data-react-fancy-icon"));
  const t = resolveTarget(icon as unknown as Element);
  assert.deepEqual(t, {
    component: "streaming-audio",
    part: "play",
    instance: "site-radio-player",
    role: "button",
    name: "Play",
  });
});

test("an input's value is never read; only its accessible name is", () => {
  const player = streamingAudio();
  const range = find(player, (el) => el.tagName === "INPUT");
  const t = resolveTarget(range as unknown as Element);
  assert.equal(t?.part, "volume");
  assert.equal(t?.name, "Volume");
  assert.ok(!JSON.stringify(t).includes("80"), "input value must not appear");
});

test("a click on non-interactive text yields component none and no name", () => {
  const root = h("main", {}, h("section", {}, h("p", {}, "A long paragraph of body copy that is not a control.")));
  const p = find(root, (el) => el.tagName === "P");
  assert.deepEqual(resolveTarget(p as unknown as Element), { component: "none" });
});

test("text of a react-fancy container is never used as a name", () => {
  const root = h("div", { "data-react-fancy-card": "" }, h("h3", {}, "Pricing"), h("p", {}, "Short"));
  const p = find(root, (el) => el.tagName === "P");
  assert.deepEqual(resolveTarget(p as unknown as Element), { component: "card" });
});

test("a control's own text over 60 characters is dropped, and whitespace is normalised", () => {
  const long = h("button", {}, "x".repeat(61));
  assert.deepEqual(resolveTarget(long as unknown as Element), { component: "none", role: "button" });

  const spaced = h("button", {}, h("span", {}, "  Add"), h("span", {}, "\n\tto   cart "));
  assert.equal(resolveTarget(spaced as unknown as Element)?.name, "Add to cart");
});

test("child elements are joined with a space, not mashed together", () => {
  const btn = h("a", { href: "/k" }, h("span", {}, "Kit"), h("span", {}, "v0.5"));
  assert.equal(resolveTarget(btn as unknown as Element)?.name, "Kit v0.5");
});

test("instance comes from data-heuristics-id, data-fancy-id or id within the component only", () => {
  const outer = h(
    "section",
    { id: "outer-section" },
    h("div", { "data-react-fancy-tabs": "" }, h("button", { role: "tab", "data-fancy-id": "tab-billing" }, "Billing")),
  );
  const tab = find(outer, (el) => el.getAttribute("role") === "tab");
  assert.deepEqual(resolveTarget(tab as unknown as Element), {
    component: "tabs",
    instance: "tab-billing",
    role: "tab",
    name: "Billing",
  });

  // The section's id is outside the component and must not be used.
  const plain = h("section", { id: "outer-section" }, h("button", {}, "Go"));
  const go = find(plain, (el) => el.tagName === "BUTTON");
  assert.equal(resolveTarget(go as unknown as Element)?.instance, undefined);
});

test("labels: 'none' drops names but keeps structure", () => {
  const player = streamingAudio();
  const btn = find(player, (el) => el.getAttribute("data-streaming-control") === "play");
  const t = resolveTarget(btn as unknown as Element, { labels: "none" });
  assert.equal(t?.name, undefined);
  assert.equal(t?.component, "streaming-audio");
});

test("data-testid is not an analytics handle", () => {
  const btn = h("button", { "data-testid": "submit-btn" }, "Submit");
  assert.equal(resolveTarget(btn as unknown as Element)?.instance, undefined);
});

test("null target resolves to undefined", () => {
  assert.equal(resolveTarget(null), undefined);
});
