# 8. Design guide fixtures (`docs/guide`)

Part of the [internal API catalog](../INTERNAL-API.md). The code is the source of truth: read the file a row names before relying on it.

`docs/guide` is a documentation-only browser build. It renders production renderer components, CSS, fonts and translations with synthetic data. None of its exports are application APIs, and it adds no IPC channel, account capability or application hook. Its contract is [`docs/guide/AGENTS.md`](../guide/AGENTS.md).

- [`design.html`](../design.html) loads `guide-entry.tsx`, the human guide.
- [`glass.html`](../glass.html) loads `scene-entry.tsx`, which hosts one scene.
- Scripts: `npm run guide:dev`, `guide:typecheck`, `guide:build` (output in `dist/design-guide`), `guide:preview`, and `design:tokens` / `design:tokens:check`.

| Symbol | File | Purpose |
| --- | --- | --- |
| `createFixtureBridge`, `installFixtureBridge`, `FixtureBridge`, `fixtureAuth` | [`fixture-bridge.ts`](../guide/fixture-bridge.ts) | Synthetic `window.vrx`. The own profile is a sample per platform that a Save changes in memory only. `installFixtureBridge` throws if a bridge already exists, then defines a frozen, non-writable one. Every callback reads or mutates in-memory fixtures only; joins fail closed, sign-in fails with `sessionCleared`, `importSession` reports `session_import_not_found`, URL and updater actions do nothing. |
| `friends`, `worlds`, `worldImages`, `linkedSnapshot`, `instanceExamples`, `getPlatformSnapshot`, `getWorldSnapshot`, `PlatformMode` | [`fixtures.ts`](../guide/fixtures.ts) | Sample data typed against the shared models, with local SVG illustrations. `instanceExamples` covers every instance type on both platforms. Not evidence about live platform behavior. |
| `sourceScenarios`, `exploreScenarios`, `drawerScenarios`, `friendsScenarios`, `friendsFailureFor`, `sourceModesFor`, `desktopScenes` | [`scenarios.ts`](../guide/scenarios.ts) | The one registry of selectable states: Explore source states, room-sheet loading, error and stale, drawer note load and save failures, and a failed or stale roster platform. `desktopScenes` lists scenes framed at the desktop size. |
| `mountScene` | [`scene-renderer.tsx`](../guide/scene-renderer.tsx) | Seeds the production `queryClient` (no retry, no refetch, infinite stale and cache time) and the settings and UI stores, then mounts the scene. AppShell scenes: `dashboard` (variant `hot-first`), `hot`, `friends`, `avatars`, `linked`, `settings`, `updater`. Also `login`, `drawer`, `join` and `setup` (variants `ready`, `signed-out` and `save-error`; the real `SetupWizard`, then AppShell once finished or skipped). `settings` adds `save-error` and `read-error` (defaults standing in for an unreadable file). |
| `CatalogScene`, `CatalogSceneProps` | [`catalog-scenes.tsx`](../guide/catalog-scenes.tsx) | Component scenes `icons`, `explore`, `materials`, `layers`, `semantics`, `instances`, `typography`, `controls` and `feedback`. Callbacks change local state only. |
| `Guide` | [`guide.tsx`](../guide/guide.tsx) | The human guide. Embeds scenes in iframes with per-scene theme, glow and state selectors and an Open scene link. |
| `TypeInspector` | [`type-inspector.tsx`](../guide/type-inspector.tsx) | Shows computed typography read from the rendered components, never a copied scale. |
| `CSS_SAMPLES`, `CssSelector`, `JSX_SAMPLES`, `JsxSampleId` | [`codeSamples.ts`](../guide/codeSamples.ts) | The code the guide shows beside examples: `main.css` selectors (read from the stylesheet at build time) and short usage snippets of real components. |
| `extractCssRule`, `declarationsOf`, `readDesignTokens`, `groupDesignTokens`, `renderDesignTokenReference`, `replaceDesignTokenReference` | [`cssTokens.ts`](../guide/cssTokens.ts) | Reads rules and tokens straight from `main.css`. No imports, so the guide, `design-doc.test.ts` and `design-tokens.mjs` share it. |
| `design-tokens.mjs` | [`design-tokens.mjs`](../guide/design-tokens.mjs) | `npm run design:tokens` rewrites DESIGN.md Appendix A between its `design-tokens` markers; `design:tokens:check` only checks it. |

How a scene loads: `glass.html?scene=…` without `render=1` draws the scene frame (theme, glow, state, grayscale, background picture and reset controls, plus the source revision) around an iframe. With `render=1`, `scene-entry.tsx` installs the fixture bridge first, then imports `scene-renderer.tsx`, so no connected component module runs before the fake bridge is sealed. The guide applies the theme with the production `applyTheme`; scenes call `useApplyTheme` and `useApplyGlow`. `production.css` imports the shipped `main.css` and scans the renderer source for classes. Vite aliases `@renderer` and `@shared` to the production source.

Isolation rules contributors must honor:

- Never touch real accounts, credentials, persistence, network, external images, game launches or updater actions. Fixture callbacks change synthetic memory only. `fixture-bridge.test.ts` checks this.
- Import production components, tokens, copy and fonts. Do not copy markup or CSS into the guide, and do not change production UI to make a scene easier.
- Keep seeded query data for the scene document's lifetime. Add no polling, refetch or timers that start work.
- A guide-owned overlay that takes focus opens only after reader input and returns focus to its opener (the drawer and join scenes open from a button).
- Label each example as a static sample, interactive fixture or proposal, and keep guide controls outside the app examples.
- Dark is the default scene. Check light parity, and keep the 900×670 desktop floor; let the guide scroll rather than hide controls.
- Keep guide source and output out of packages. `electron-builder.yml` excludes `docs/guide/**`, `docs/design.html`, `docs/glass.html` and `dist/design-guide/**`, and the renderer entry never imports `docs/guide`.
- When the bridge type changes, update `createFixtureBridge` in the same PR; `npm run guide:typecheck` fails until it matches.
