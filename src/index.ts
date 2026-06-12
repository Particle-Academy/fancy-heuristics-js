/**
 * @particle-academy/fancy-heuristics-js — zero-dependency browser collector SDK
 * for Fancy Heuristics. Batches human + agent interaction events and ships them
 * to a `fancy-heuristics` PHP ingestion endpoint via `navigator.sendBeacon`.
 *
 * Core entry: zero React. Import `@particle-academy/fancy-heuristics-js/react`
 * for the `useHeuristics` hook, or load `dist/fancy-heuristics.global.min.js`
 * for a `<script>`-tag auto-init.
 */
export { createCollector, describeTarget } from "./collector.ts";
export {
  buildPageview,
  buildClick,
  buildScroll,
  buildPointer,
  buildDwell,
  scrollPercent,
} from "./events.ts";
export { EventBuffer, joinCollect, defaultSend, type SendFn } from "./buffer.ts";
export {
  resolveSessionId,
  generateSessionId,
  SESSION_KEY,
  type SessionStore,
} from "./session.ts";
export { tapAgentActivity, mapActivityToEvent } from "./agent.ts";
export { buildContext, parseUtm } from "./context.ts";
export type {
  Actor,
  Collector,
  CollectorOptions,
  CollectBatch,
  EventKind,
  HeuristicsEvent,
  SessionContext,
  TrackConfig,
} from "./types.ts";
