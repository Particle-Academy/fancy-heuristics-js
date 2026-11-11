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

### Changed

- **Releases need a lab-run certificate.** `publish.yml` gains a read-only
  `lab-certificate` job that every publishing job needs: a tag is published only
  when the fancy-labs lab has certified that exact version and commit. Consumers
  do nothing; this changes how releases are cut, not what the package does.

## [0.4.0] — 2026-11-08

This release fixes the analytics the showcase was showing: click labels like
`Fancy UI Kitv0.5DocsLearnPackages…MoreSign` (the whole site header, cut at
120 characters), no page titles, one pageview per tab on single-page apps, and
agent tool calls counted as clicks. It needs `particle-academy/fancy-heuristics`
**0.6** or newer to store the new fields.

### Changed

- **BREAKING — consent is denied by default. With no `consent` option,
  nothing is collected.** The collector attaches no listener and sends
  nothing, and in development it logs one console warning saying so.
  **What you must do:** pass `consent: true` or a consent callback, or wire
  fancy-compliance, otherwise nothing is collected. With fancy-compliance,
  create the collector with its current `analytics` decision and call
  `collector.setConsent(granted)` whenever that decision changes.
- **BREAKING — the collector sends wire format v2.** Every batch carries
  `schemaVersion: 2`, a `batchId` and `sentAt`; every event carries an
  `eventId` and a `<domain>.<verb>` `name` (`ui.view`, `ui.activate`,
  `engage.time`, `engage.scroll`, `pointer.sample`, `agent.act`). Events still
  carry `kind` and `path`, so a server older than 0.6 keeps storing views,
  clicks, scroll and time as before. **What you must do:** upgrade
  `fancy-heuristics` to 0.6 first. If you read raw batches yourself, read
  `name` instead of `kind`.
- **BREAKING — click labels come from the clicked control only.** The old
  resolver climbed five ancestors and used the fifth one's `textContent`,
  which joins text with no separator. Clicks now carry `target: { component,
  part, instance, role, name }`: react-fancy's `data-react-fancy-*` handles,
  `data-<x>-control` / `-part`, `data-heuristics-id` / `data-fancy-id` / `id`
  inside the component, and the control's accessible name (60 characters at
  most, whitespace collapsed). No free-text `label` is sent. `data-testid` is
  no longer used as a handle. **What you must do:** nothing, unless you relied
  on `data-testid` for analytics; use `data-heuristics-id` instead.
- **BREAKING — agent activity is `agent.act`, not a click.** The verb is in
  `props.action`, the surface in `target.component`, and no pointer
  coordinates are sent, so agent actions no longer land on click counts or
  heatmaps. `mapActivityToEvent` returns the v2 event. **What you must do:**
  nothing, unless you call `mapActivityToEvent` directly.
- **BREAKING — pointer samples are off by default.** They were most of the
  stored rows. Turn them on with `collect: "research"` or
  `track: { pointer: true }`.
- **Dwell is now active time (`engage.time`).** It counts only while the tab
  is visible and there was input in the last 30 s, and it is sent per view
  (on navigation, on hide, on `pagehide`, and every 15 s) rather than every
  1.5 s. An idle open tab no longer accumulates time.
- **Scroll is now milestones** (25, 50, 75, 90, 100), each once per view,
  instead of every new maximum.
- A batch the transport refuses is retried unchanged, with the same
  `batchId`, so the server can drop a duplicate.
- `describeTarget` is deprecated. It now returns the resolved `instance` and
  accessible `name`, never a container's text.

### Added

- **Single-page pageviews.** `ui.view` is recorded on `pushState`,
  `popstate`, the Navigation API's `navigatesuccess` and Inertia's
  `inertia:navigate`. `replaceState` on the same URL is ignored and repeats
  within 500 ms count once. The title is read 50 ms after the navigation
  (`viewDelayMs`), once the new page has set it. `stop()` puts
  `history.pushState` / `replaceState` back. `spa: false` turns detection off;
  `collector.view()` records one by hand.
- **Route and title as separate fields.** `route: () => ({ name, pattern })`
  and `title: () => string` (default `document.title`, bounded to 120). The
  title is sent on `ui.view` only.
- **Consent.** `consent` takes `true` / `"granted"`, `false` / `"denied"`,
  or a callback read at `start()`. `setConsent(true)` grants it later;
  `setConsent(false)` stops collection at once and drops anything not yet
  sent.
- **Collection tiers.** `collect: "essential" | "analytics" | "research"`.
- `collector.track(name, { target, props })`, `resolveTarget()`,
  `buildEvent()`, `CORE_NAMES`, `kindForName()` and the v2 types.

### Fixed

- **`CHANGELOG.md` is now in the published tarball.** `files` did not whitelist it, so npm never shipped it — and this package puts breaking changes in MINOR releases and tells you in the README to read the entry before taking one. The instruction existed for the author, who has the file, and not for the consumer, who is the only one being instructed. Nothing for you to do; the file simply arrives from this release on.

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
