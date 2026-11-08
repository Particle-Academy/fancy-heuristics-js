/**
 * Optional agent-actor tap. If `@particle-academy/fancy-auto-common` is
 * resolvable at runtime we subscribe to its activity registry and translate
 * events whose `source` is "agent" or "flow" into `actor:"agent"` Events. When
 * the module is absent the subscribe call resolves to a no-op unsubscribe — the
 * collector keeps working for humans only. The import is dynamic + best-effort
 * so the peer never becomes a hard runtime dependency.
 */
import { buildEvent } from "./events.ts";
import type { EventProps, EventTarget2, HeuristicsEventV2 } from "./types.ts";

/** The slice of the AutoActivityEvent shape we consume. */
interface AutoActivityEventLike {
  agentId: string;
  agentName?: string;
  target: { kind?: string; elementId?: string; label?: string };
  action: string;
  timestamp: number;
  meta?: Record<string, unknown>;
  source?: string;
}

type Unsubscribe = () => void;

/** Module surface we rely on — narrowed so a partial mock satisfies it. */
interface AutoCommonModule {
  onActivity: (
    listener: (e: AutoActivityEventLike) => void,
    filter?: { source?: string },
  ) => Unsubscribe;
}

export interface AgentTapOptions {
  path: () => string;
  emit: (event: HeuristicsEventV2) => void;
  /** Override the dynamic import (tests inject a mock module here). */
  loadModule?: () => Promise<AutoCommonModule | undefined>;
}

/**
 * Map one activity event to an `actor:"agent"` wire-v2 event. An activity
 * carrying a `dwellMs` meta becomes `engage.time`; everything else becomes
 * `agent.act`, with the real verb in `props.action` and the surface in
 * `target.component`. An agent action is never recorded as a click
 * (`ui.activate`), and it carries no pointer coordinates, so it can never
 * land on a heatmap. Returns undefined when the activity isn't from an
 * agent/flow source.
 */
export function mapActivityToEvent(
  e: AutoActivityEventLike,
  path: string,
): HeuristicsEventV2 | undefined {
  const source = e.source ?? "agent";
  if (source !== "agent" && source !== "flow") return undefined;

  const target: EventTarget2 = { component: handle(e.target?.kind) ?? "none" };
  const instance = handle(e.target?.elementId);
  if (instance) target.instance = instance;
  const name = boundedName(e.target?.label);
  if (name) target.name = name;

  const props: EventProps = { action: handle(e.action) ?? "unknown", source };
  const agent = handle(e.agentId);
  if (agent) props.agent = agent;

  const dwellMs = numericMeta(e.meta, "dwellMs");
  if (dwellMs !== undefined) {
    return buildEvent("engage.time", { actor: "agent", path, ts: e.timestamp, dwellMs, target, props });
  }

  return buildEvent("agent.act", { actor: "agent", path, ts: e.timestamp, target, props });
}

function handle(v: unknown): string | undefined {
  return typeof v === "string" && v !== "" ? v.slice(0, 64) : undefined;
}

function boundedName(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.replace(/\s+/g, " ").trim();
  return s ? s.slice(0, 60) : undefined;
}

function numericMeta(meta: Record<string, unknown> | undefined, key: string): number | undefined {
  const v = meta?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/**
 * Subscribe to the agent bus if present. Resolves to an unsubscribe function;
 * if the peer is absent the unsubscribe is a no-op. Never throws.
 */
export async function tapAgentActivity(opts: AgentTapOptions): Promise<Unsubscribe> {
  const load = opts.loadModule ?? defaultLoad;
  let mod: AutoCommonModule | undefined;
  try {
    mod = await load();
  } catch {
    mod = undefined;
  }
  if (!mod || typeof mod.onActivity !== "function") return () => {};

  try {
    return mod.onActivity((e) => {
      const ev = mapActivityToEvent(e, opts.path());
      if (ev) opts.emit(ev);
    });
  } catch {
    return () => {};
  }
}

/**
 * Best-effort dynamic import of the optional peer. The specifier is hidden
 * behind a variable so bundlers don't try to resolve it at build time — it's a
 * runtime-only, optional dependency.
 */
async function defaultLoad(): Promise<AutoCommonModule | undefined> {
  const spec = "@particle-academy/fancy-auto-common";
  try {
    const mod = (await import(/* @vite-ignore */ spec)) as Partial<AutoCommonModule>;
    if (mod && typeof mod.onActivity === "function") {
      return mod as AutoCommonModule;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
