# Design guide

## Purpose

`docs/guide` builds the human design guide and isolated component scenes from
production renderer code, CSS, fonts, translations, and synthetic data.
`docs/design.html` is the guide, `docs/glass.html` hosts scenes, and
`docs/DESIGN.md` states the design rules.

## Ownership

- This directory owns guide-only React, fixtures, scene styling, and Vite setup.
  Production components, tokens, translations, fonts, and behavior stay in
  `src/renderer`; import them rather than copying markup or CSS.
- `fixture-bridge.ts` owns a sealed synthetic bridge. It refuses an existing app
  bridge and never accesses real accounts, credentials, persistence, network,
  external images, game launches, or updater actions. Fixture callbacks mutate
  synthetic memory only.
- `fixtures.ts` owns schema-valid sample data and local illustrations. It is not
  evidence about live platform behavior. `scenarios.ts` keeps source, room,
  drawer, loading, retained refresh, expiry/recovery, and note failure/retry
  states selectable. Keep seeded query data for a scene document's lifetime and
  do not add polling.

## Local Contracts

- Label static samples, interactive fixtures, and proposals. Keep guide controls
  outside app examples. Do not redesign production UI to make a scene easier to
  build, or turn a known defect into a design rule.
- Keep source revision and component references visible without cluttering the
  examples.
- Reuse production theme and glow applicators. Dark is the default scene; verify
  light parity and root overlay context. Information-bearing surfaces must use
  the production backing so ambient color cannot alter their meaning.
- Preserve the 900x670 desktop floor in embedded and standalone examples. Let
  the guide scroll around the window instead of hiding controls.
- A guide-owned focus-taking overlay opens only after reader input and restores
  focus to its opener. Keep synthetic reads fresh where a scene claims success.
- Keep guide source and generated output out of packaged application artifacts.
  Do not claim a source or build check proves installed-app visual fidelity.

## Work Guidance

Read the root, renderer contract, `docs/DESIGN.md`, and the guide entries in
`docs/INTERNAL-API.md` before changing imported behavior or fixtures. Prefer a
whole production parent when a private child cannot stand alone. Keep guide
fixtures isolated when production bridge types evolve.

## Verification

Run `npm run guide:typecheck`, relevant fixture or catalog tests, and
`npm run guide:build` for guide changes. Inspect affected scenes in both themes
when the result changes visually. Run the canonical gate in
`docs/DEVELOPMENT.md` if production code or build configuration changes.

## Child DOX Index

No children.
