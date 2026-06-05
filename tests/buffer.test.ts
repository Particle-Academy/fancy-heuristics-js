import { test } from "node:test";
import assert from "node:assert/strict";
import { EventBuffer, joinCollect } from "../src/buffer.ts";
import { buildPageview } from "../src/events.ts";
import type { CollectBatch } from "../src/types.ts";

test("joinCollect appends /collect, tolerating trailing slash", () => {
  assert.equal(joinCollect("https://h/heuristics"), "https://h/heuristics/collect");
  assert.equal(joinCollect("https://h/heuristics/"), "https://h/heuristics/collect");
  assert.equal(joinCollect("https://h/heuristics///"), "https://h/heuristics/collect");
});

test("flush sends one batch matching the wire contract { siteKey, sessionId, events }", () => {
  const sent: Array<{ url: string; body: string }> = [];
  const buf = new EventBuffer({
    siteKey: "SITE",
    endpoint: "https://h/heuristics",
    sessionId: "sess-1",
    send: (url, body) => {
      sent.push({ url, body });
      return true;
    },
  });

  buf.add(buildPageview("/a", 1));
  buf.add(buildPageview("/b", 2));
  assert.equal(buf.size, 2);

  buf.flush();

  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.url, "https://h/heuristics/collect");
  const batch = JSON.parse(sent[0]!.body) as CollectBatch;
  assert.deepEqual(Object.keys(batch).sort(), ["events", "sessionId", "siteKey"]);
  assert.equal(batch.siteKey, "SITE");
  assert.equal(batch.sessionId, "sess-1");
  assert.equal(batch.events.length, 2);
  assert.equal(batch.events[0]!.path, "/a");
  // buffer drained after a successful send
  assert.equal(buf.size, 0);
});

test("flush is a no-op when empty", () => {
  let calls = 0;
  const buf = new EventBuffer({
    siteKey: "S",
    endpoint: "https://h",
    sessionId: "x",
    send: () => {
      calls++;
      return true;
    },
  });
  buf.flush();
  assert.equal(calls, 0);
});

test("failed send keeps events for retry", () => {
  let attempts = 0;
  const buf = new EventBuffer({
    siteKey: "S",
    endpoint: "https://h",
    sessionId: "x",
    send: () => {
      attempts++;
      return attempts > 1; // fail first, succeed second
    },
  });
  buf.add(buildPageview("/a", 1));
  buf.flush(); // fails
  assert.equal(buf.size, 1);
  buf.flush(); // succeeds
  assert.equal(buf.size, 0);
  assert.equal(attempts, 2);
});
