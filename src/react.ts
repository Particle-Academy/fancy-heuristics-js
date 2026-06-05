/**
 * React subpath — `@particle-academy/fancy-heuristics-js/react`.
 *
 * `useHeuristics(opts)` creates and starts a collector for the lifetime of the
 * mounting component, stopping (and flushing) it on unmount. React is a peer
 * dependency — never bundled. The collector is recreated only when the identity
 * fields (`siteKey` / `endpoint`) change, so passing a fresh `track` object each
 * render won't thrash listeners.
 */
import { useEffect, useRef } from "react";
import { createCollector } from "./collector.ts";
import type { Collector, CollectorOptions } from "./types.ts";

export function useHeuristics(opts: CollectorOptions): void {
  // Keep the latest options in a ref so the effect can read them without
  // re-subscribing on every render.
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    let collector: Collector | undefined;
    try {
      collector = createCollector(optsRef.current);
      collector.start();
    } catch {
      collector = undefined;
    }
    return () => {
      collector?.stop();
    };
    // Re-run only when the identity of the stream changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.siteKey, opts.endpoint]);
}

export type { Collector, CollectorOptions } from "./types.ts";
