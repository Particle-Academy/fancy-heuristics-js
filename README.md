# @particle-academy/fancy-heuristics-js

[![Fancified](art/fancified.svg)](https://particle.academy)

Zero-dependency **browser collector SDK** for [Fancy
Heuristics](https://github.com/Particle-Academy/fancy-heuristics). It batches
human **and** agent interaction events — `pageview`, `click`, `scroll` depth,
`pointer` heatmap samples, and `dwell` time — and ships them to a
`fancy-heuristics` PHP ingestion endpoint via `navigator.sendBeacon`.

This is the JS/TS mirror of the PHP record surface; the two share one **frozen
wire contract** so the collector and the ingestion API evolve independently.

- **Zero runtime dependencies.**
- Optional peer `@particle-academy/fancy-auto-common` — when present, agent /
  flow activity is folded into the same event stream tagged `actor:"agent"`. When
  absent, the SDK no-ops gracefully (humans only).
- Ships **ESM + CJS + a minified IIFE global** (`window.FancyHeuristics`) for
  `<script>`-tag embed, plus a `./react` hook.

## Install

```bash
npm install @particle-academy/fancy-heuristics-js
```

## Quick start (module)

```ts
import { createCollector } from "@particle-academy/fancy-heuristics-js";

const collector = createCollector({
  siteKey: "YOUR_SITE_KEY",
  endpoint: "https://your-host/heuristics", // /collect is appended on flush
});
collector.start();
// later, e.g. on SPA route teardown:
// collector.stop();   // flushes remaining events + detaches listeners
```

`start()` emits the initial `pageview`, attaches **one** delegated capture-phase
`click` listener on `document`, a throttled passive `scroll` listener (tracks max
depth), a throttled passive `pointermove` sampler (heatmap), and dwell accounting
via `visibilitychange`. Events buffer and flush every ~1.5s and on `pagehide`.

### Options

| Option | Default | Meaning |
|---|---|---|
| `siteKey` | — (required) | Identifies the site to the endpoint. |
| `endpoint` | — (required) | Base URL; `/collect` is appended on flush. |
| `track` | all on | Per-signal opt-out: `{ pageview, dwell, click, scroll, pointer, agent }`. |
| `flushMs` | `1500` | Batch flush window. |
| `pointerThrottleMs` | `120` | Pointer-sample throttle. |
| `scrollThrottleMs` | `200` | Scroll-sample throttle. |

## `<script>`-tag embed

```html
<script
  src="https://unpkg.com/@particle-academy/fancy-heuristics-js/dist/fancy-heuristics.global.min.js"
  data-site="YOUR_SITE_KEY"
  data-endpoint="https://your-host/heuristics"
  data-track="pageview,click,scroll,pointer,dwell,agent"></script>
```

The bundle auto-initialises off its own `data-*` attributes. `data-site` and
`data-endpoint` are required; omitting `data-track` tracks everything. The global
also exposes `FancyHeuristics.createCollector({...})` for programmatic use.

## React

```tsx
import { useHeuristics } from "@particle-academy/fancy-heuristics-js/react";

function App() {
  useHeuristics({ siteKey: "YOUR_SITE_KEY", endpoint: "https://your-host/heuristics" });
  return <YourApp />;
}
```

The hook creates + starts a collector for the component's lifetime and stops
(flushing) it on unmount. React is a peer dependency — never bundled.

## Agent activity

If `@particle-academy/fancy-auto-common` resolves at runtime, the collector
subscribes to its activity registry and maps events whose `source` is `"agent"`
or `"flow"` into `actor:"agent"` Events (`dwell` when the activity carries a
`dwellMs` meta, otherwise a discrete `click`-style interaction). The import is
dynamic and best-effort, so the peer never becomes a hard dependency — heatmaps
and focus maps then cover agents and humans on the same surface.

## The wire contract

Every event matches this shape exactly (optional fields are **omitted**, never
`null`, when not relevant to the `kind`):

```ts
type Event = {
  kind: "pageview" | "click" | "scroll" | "pointer" | "dwell";
  actor: "human" | "agent";
  path: string;          // location.pathname
  ts: number;            // ms epoch
  x?: number; y?: number;   // pointer/click, viewport coords
  vw?: number; vh?: number; // viewport size (heatmap normalisation)
  scrollPct?: number;       // scroll depth 0..100
  dwellMs?: number;         // time-on-page chunk
  targetId?: string; label?: string;
  meta?: object;
};
```

Batches POST to `${endpoint}/collect` as:

```json
{ "siteKey": "...", "sessionId": "...", "events": [ /* Event, ... */ ] }
```

`sessionId` is persisted in `sessionStorage` (generated with `crypto.randomUUID`,
falling back to `crypto.getRandomValues`, then a time+counter id — never
`Math.random`).

## Build / test

```bash
npm install
npm run build   # tsup → ESM + CJS + IIFE + react entry + d.ts
npm test        # node:test
npm run lint    # tsc --noEmit
```

## License

MIT
