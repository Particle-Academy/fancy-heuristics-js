/**
 * Optional agent-actor tap. If `@particle-academy/fancy-auto-common` is
 * resolvable at runtime we subscribe to its activity registry and translate
 * events whose `source` is "agent" or "flow" into `actor:"agent"` Events. When
 * the module is absent the subscribe call resolves to a no-op unsubscribe — the
 * collector keeps working for humans only. The import is dynamic + best-effort
 * so the peer never becomes a hard runtime dependency.
 */
import { buildClick, buildDwell } from "./events.ts";
import type { HeuristicsEvent } from "./types.ts";

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
  emit: (event: HeuristicsEvent) => void;
  /** Override the dynamic import (tests inject a mock module here). */
  loadModule?: () => Promise<AutoCommonModule | undefined>;
}

/**
 * Map one activity event to an `actor:"agent"` Event. Activities carrying a
 * `dwellMs` meta become dwell events; everything else is treated as a discrete
 * "click"-style interaction on the named target. Returns undefined when the
 * activity isn't from an agent/flow source.
 */
export function mapActivityToEvent(
  e: AutoActivityEventLike,
  path: string,
): HeuristicsEvent | undefined {
  const source = e.source ?? "agent";
  if (source !== "agent" && source !== "flow") return undefined;

  const targetId = e.target?.elementId;
  const label = e.target?.label;
  const dwellMs = numericMeta(e.meta, "dwellMs");

  if (dwellMs !== undefined) {
    const ev = buildDwell({ path, ts: e.timestamp, dwellMs, actor: "agent" });
    if (targetId !== undefined) ev.targetId = targetId;
    if (label !== undefined) ev.label = label;
    ev.meta = { action: e.action, agentId: e.agentId, source };
    return ev;
  }

  const ev = buildClick({
    path,
    ts: e.timestamp,
    x: numericMeta(e.meta, "x") ?? 0,
    y: numericMeta(e.meta, "y") ?? 0,
    vw: numericMeta(e.meta, "vw") ?? 0,
    vh: numericMeta(e.meta, "vh") ?? 0,
    actor: "agent",
    targetId,
    label,
    meta: { action: e.action, agentId: e.agentId, source },
  });
  return ev;
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
