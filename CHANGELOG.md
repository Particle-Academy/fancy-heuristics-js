# Changelog

All notable changes to `@particle-academy/fancy-heuristics-js` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

> **Pre-1.0:** breaking changes land in MINOR releases. Until 1.0 the minor
> number is not a compatibility promise — read the entry, not the version.

> This file starts here. Earlier releases predate it and were never written up;
> `git log` is the record for those. It is not backfilled rather than
> guessed-at, because a changelog that invents its own history is worse than one
> that admits where it begins.

## [Unreleased]

## [0.3.0] — 2026-08-07

### Changed

- **BREAKING — Node 18 is no longer supported.** `engines.node` moves from `>=18` to `>=22`.

  **What you must do:** on Node 22 or newer, nothing. Note npm only *warns* on an `engines` mismatch while **pnpm fails the install**, so this surfaces differently depending on your package manager. Node 18 is end-of-life and 20 is maintenance-only.

- **BREAKING — React 18 is no longer supported.** `peerDependencies.react` / `react-dom` are now `^19.0.0`.

  **What you must do:** on React 19, nothing. On React 18, stay on the previous release, or upgrade your app to 19 first.

  React 18 support was a claim nothing tested — every build and test in this package ran against 19, so the 18 half of the old range was never executed. An untested compatibility claim is worse than an absent one, because it reads as support.

### Why

These are the kit 0.5 platform floors, applied across every package at once so a consumer never has to resolve a mix. **No API changed, nothing was removed, nothing was renamed** — only what the package requires.


## [0.2.1] — 2026-07-29

### Security

- **`joinCollect` could stall the browser's main thread on a hostile endpoint**
  (CodeQL `js/polynomial-redos`, high). It trimmed trailing slashes with
  `replace(/\/+$/, "")`; the engine retries `\/+$` from every position, so an
  endpoint containing a long run of slashes that does *not* end in one costs
  O(n²) — seconds of frozen UI for a ~100k-character value.

  The endpoint is library input, supplied by the host, so it is not
  automatically trustworthy, and this runs on the main thread where a stall is
  visible to the user rather than buried in a worker.

  Now trimmed by index in one linear pass, with no regex engine involved.
  **No action needed** — the output is identical for every input; only the
  timing changed. A test asserts a wall-clock budget on the pathological case
  and fails against the previous implementation.

### Changed

- Widened the `@particle-academy/fancy-auto-common` requirement from `^0.1.0` to `>=0.1 <2.0`, so a
  sibling minor release is an upgrade and not a resolver conflict. **No action
  needed** — widening a range only adds candidates; the version you have today
  still resolves.

  A caret on a `0.x` range locks the MINOR, so this pinned a sibling at
  whatever it happened to be on the day it was written, and each sibling
  release then read as a conflict to the resolver rather than an upgrade.
  Nothing here was using an API the newer minors removed — the range was the
  whole problem.
