import { defineConfig } from "tsup";

export default defineConfig([
  // ESM + CJS library bundles (core + react subpath). Browser/neutral platform;
  // the optional agent-bus peer is resolved lazily so it never becomes a hard dep.
  {
    entry: { index: "src/index.ts", react: "src/react.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    platform: "neutral",
    // React + the optional agent bus must stay external (peer deps, not bundled).
    external: ["react", "@particle-academy/fancy-auto-common"],
    treeshake: true,
  },
  // Minified IIFE global for <script>-tag embed. Self-initialises off its own
  // <script data-*> attributes. The agent bus is intentionally NOT bundled — in
  // a script-tag context there is no module graph to import it from.
  {
    entry: { "fancy-heuristics.global": "src/global.ts" },
    format: ["iife"],
    globalName: "FancyHeuristics",
    minify: true,
    sourcemap: true,
    platform: "browser",
    dts: false,
    clean: false,
    outExtension() {
      return { js: ".min.js" };
    },
  },
]);
