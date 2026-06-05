import { test } from "node:test";
import assert from "node:assert/strict";
import { mapActivityToEvent, tapAgentActivity } from "../src/agent.ts";

test("maps an agent-source activity to actor:agent click event", () => {
  const ev = mapActivityToEvent(
    {
      agentId: "agent-7",
      target: { kind: "form", elementId: "email", label: "the email field" },
      action: "form_fill",
      timestamp: 4242,
      source: "agent",
    },
    "/checkout",
  );
  assert.ok(ev);
  assert.equal(ev!.kind, "click");
  assert.equal(ev!.actor, "agent");
  assert.equal(ev!.path, "/checkout");
  assert.equal(ev!.ts, 4242);
  assert.equal(ev!.targetId, "email");
  assert.equal(ev!.label, "the email field");
  assert.deepEqual(ev!.meta, { action: "form_fill", agentId: "agent-7", source: "agent" });
});

test("flow source also becomes actor:agent", () => {
  const ev = mapActivityToEvent(
    { agentId: "flow-1", target: { kind: "flow" }, action: "node_run", timestamp: 1, source: "flow" },
    "/",
  );
  assert.ok(ev);
  assert.equal(ev!.actor, "agent");
});

test("activity with dwellMs meta becomes a dwell event", () => {
  const ev = mapActivityToEvent(
    {
      agentId: "a",
      target: { kind: "ux", label: "panel" },
      action: "ux_focus",
      timestamp: 10,
      source: "agent",
      meta: { dwellMs: 3000 },
    },
    "/p",
  );
  assert.ok(ev);
  assert.equal(ev!.kind, "dwell");
  assert.equal(ev!.dwellMs, 3000);
  assert.equal(ev!.actor, "agent");
});

test("non agent/flow source is ignored", () => {
  const ev = mapActivityToEvent(
    { agentId: "x", target: { kind: "ux" }, action: "noop", timestamp: 1, source: "human" },
    "/",
  );
  assert.equal(ev, undefined);
});

test("missing source defaults to agent and maps", () => {
  const ev = mapActivityToEvent(
    { agentId: "x", target: { kind: "ux" }, action: "a", timestamp: 1 },
    "/",
  );
  assert.ok(ev);
  assert.equal(ev!.actor, "agent");
});

test("tapAgentActivity subscribes through an injected module and forwards events", async () => {
  const collected: unknown[] = [];
  let captured: ((e: any) => void) | undefined;
  const unsub = await tapAgentActivity({
    path: () => "/here",
    emit: (e) => collected.push(e),
    loadModule: async () => ({
      onActivity(listener) {
        captured = listener;
        return () => {
          captured = undefined;
        };
      },
    }),
  });

  assert.ok(captured, "listener registered");
  captured!({
    agentId: "a1",
    target: { kind: "form", elementId: "name" },
    action: "form_fill",
    timestamp: 99,
    source: "agent",
  });
  assert.equal(collected.length, 1);
  unsub();
  assert.equal(captured, undefined, "unsubscribed");
});

test("tapAgentActivity no-ops gracefully when the peer is absent", async () => {
  const unsub = await tapAgentActivity({
    path: () => "/",
    emit: () => assert.fail("should not emit"),
    loadModule: async () => undefined,
  });
  assert.equal(typeof unsub, "function");
  unsub(); // must not throw
});

test("tapAgentActivity swallows a throwing loader", async () => {
  const unsub = await tapAgentActivity({
    path: () => "/",
    emit: () => {},
    loadModule: async () => {
      throw new Error("module blew up");
    },
  });
  assert.equal(typeof unsub, "function");
});
