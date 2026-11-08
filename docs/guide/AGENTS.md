# docs/guide

## Purpose

Builds the design guide (`docs/design.html`) and isolated scenes
(`docs/glass.html`) from production renderer code and synthetic data.
[`docs/DESIGN.md`](../DESIGN.md) states the design rules.

## Ownership

- This directory owns guide-only React, fixtures, guide and scene CSS, and
  `vite.config.ts`. Production components, tokens, translations, fonts, and
  behavior stay in `src/renderer`; import them rather than copying markup or
  CSS. `production.css` compiles the real `main.css`.
- `fixture-bridge.ts` installs a frozen, non-configurable synthetic
  `window.vrx` and refuses to replace an existing bridge. It never touches real
  accounts, credentials, persistence, network, external images, launches, or
  the updater; callbacks change synthetic memory only.
- `fixtures.ts` holds sample data typed against the shared models (compile-time
  checks only, no run-time validation) and local SVG illustrations. It is not
  evidence about live platform behavior.
- `scenarios.ts` is the registry for selectable source, Explore sheet, drawer
  (including note load and save failure), and Friends failure states;
  `scene-entry.tsx` adds updater, settings save-error and read-error, and login
  variants, and `scene-renderer.tsx` the welcome-setup scene (`ready`,
  `signed-out`, `save-error`) and the Dashboard `needs-code` state (VRChat
  waiting for a sign-in code). The
  `picked-alerts` settings and drawer variant turns on the picked-friends
  alert controls, with the online and joins-a-world alerts on so the bell
  can show both states.
- `catalog-scenes.tsx` holds the static and interactive catalog scenes,
  including `layers` (the five glass layers over a picture, each pane labeled
  with its production class) and `controls` (every shared control, named).
- `guide.tsx` is the design guide page. It shows each scene beside the real
  code: CSS rules read from the shipped `main.css` at build time
  (`main.css?raw`), usage snippets from `codeSamples.ts`, and token tables
  parsed live from `main.css`.
- `cssTokens.ts` reads tokens and rules out of `main.css` (no imports, so the
  guide, its tests and `design-tokens.mjs` all use it). `design-tokens.mjs`
  (`npm run design:tokens`, `--check`) rewrites DESIGN.md Appendix A between
  its markers. `design-doc.test.ts` keeps DESIGN.md and `codeSamples.ts` in
  step with the app: generated tokens current, every named token, class,
  copied Appendix B.1 rule, guide CSS selector and sample component real.

## Local Contracts

- Show production code, never a hand-written copy of it: CSS through
  `extractCssRule` on `main.css`, components by import. A code sample in
  `codeSamples.ts` names only real components, classes and keys.
- Label each example as a static sample, an interactive fixture, or a
  proposal. Keep guide controls outside app examples. Do not redesign
  production UI to make a scene easier to build, and do not turn a known defect
  into a design rule.
- The `icons` scene imports the committed `build/icon.png` and the
  `resources/icon-16.png` and `icon-24.png` optical sizes. Keep it in step with
  the Identity section and [App icon](../APP-ICON.md); never redraw the logo in
  guide CSS.
- Use the production theme and glow applicators (`applyTheme`,
  `useApplyTheme`, `useApplyGlow`). Scenes default to dark; check light parity.
  Information-bearing surfaces use the production backing so ambient color
  cannot change their meaning.
- Keep the 900x670 desktop floor in embedded and standalone scenes. Let the
  guide scroll around the window instead of hiding controls.
- Scene queries keep seeded data for the document's lifetime: no retries,
  focus or reconnect refetches, or polling. Keep synthetic reads fresh wherever
  a scene claims success.
- A guide-owned overlay that takes focus opens only after reader input and
  returns focus to its opener.
- Show the source revision and component references without cluttering
  examples. Guide source and output stay out of application packages
  (`fixture-bridge.test.ts` checks). A source or build check does not prove
  installed-app visual fidelity.

## Work Guidance

Read the [renderer contract](../../src/renderer/AGENTS.md), `docs/DESIGN.md`,
and the catalog's [guide section](../internal-api/8-design-guide.md) before
changing imported behavior or fixtures. Prefer a whole production parent when
a private child cannot stand alone. Update the fixture bridge whenever
`src/preload/index.d.ts` changes.

## Verification

Run `npm run guide:typecheck`, the `docs/guide` tests
(`npx vitest run docs/guide`), `npm run design:tokens:check` and
`npm run guide:build`. Inspect changed scenes in both themes. Run the root gate
when production code or build configuration changes.

## Child DOX Index

No child contracts.
