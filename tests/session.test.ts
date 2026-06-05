import { test } from "node:test";
import assert from "node:assert/strict";
import { generateSessionId, resolveSessionId, type SessionStore } from "../src/session.ts";

function memStore(seed?: Record<string, string>): SessionStore & { data: Record<string, string> } {
  const data: Record<string, string> = { ...(seed ?? {}) };
  return {
    data,
    getItem: (k) => (k in data ? data[k]! : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

test("generateSessionId returns a non-empty unique id (crypto.randomUUID path)", () => {
  const a = generateSessionId();
  const b = generateSessionId();
  assert.equal(typeof a, "string");
  assert.ok(a.length > 0);
  assert.notEqual(a, b);
});

test("resolveSessionId generates + persists when store is empty", () => {
  const store = memStore();
  const id = resolveSessionId(store);
  assert.ok(id.length > 0);
  // persisted under the canonical key
  assert.equal(store.data["fancy-heuristics:sid"], id);
});

test("resolveSessionId returns the existing id on subsequent calls (persistence)", () => {
  const store = memStore();
  const first = resolveSessionId(store);
  const second = resolveSessionId(store);
  assert.equal(first, second);
});

test("resolveSessionId honours a pre-seeded id", () => {
  const store = memStore({ "fancy-heuristics:sid": "preset-123" });
  assert.equal(resolveSessionId(store), "preset-123");
});

test("a throwing store degrades to a generated (non-persisted) id", () => {
  const throwing: SessionStore = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  const id = resolveSessionId(throwing);
  assert.ok(id.length > 0);
});
