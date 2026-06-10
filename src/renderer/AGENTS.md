# src/renderer — React UI

## Purpose
The renderer process: the React + Tailwind v4 UI. Runs sandboxed; reaches the main process only through the preload bridge.

## Ownership
- `index.html`, `src/main.tsx` — React entry (`main.tsx` also initializes i18next).
- `src/App.tsx`, `src/components/` — UI components (`TokenPreview.tsx` token-preview surface; `LocaleProbe.tsx` a throwaway i18n demo — both go when real UI lands).
- `src/i18n/` — i18next + react-i18next setup (VRX-14): bundled resources, OS-locale detection via `navigator.language`, English fallback.
- `src/locales/<lng>/translation.json` — translation resources (`en`, `ja`).
- `src/assets/main.css` — Tailwind import + the VRX design tokens (§2 dark `:root`, §2A light `[data-theme="light"]`).
- Empty placeholders (`src/hooks`, `queries`, `routes`, `stores`, `utils`) — unused until features land.

## Local Contracts
- Design tokens are the single source of truth (DESIGN.md §2/§2A, defined in `assets/main.css`). NEVER hardcode color/spacing outside tokens.
- Themed colors are raw CSS vars consumed via arbitrary utilities (`bg-[var(--vrc)]`) so they flip under `[data-theme="light"]`; only the static scale (radius/fonts) lives in `@theme`.
- Tailwind v4 drops opacity modifiers on arbitrary vars (`bg-[var(--x)]/N` → solid) — use `color-mix()` or theme colors for tints.
- Dark is the default; light is a `[data-theme="light"]` override (parity, not a fork).
- Honor `prefers-reduced-motion` via Tailwind `motion-safe:`. No `!important`.
- Sandboxed: no node/electron access; reach main only through the preload-exposed API.
- User-facing strings go through i18next (`useTranslation`/`t('key')`) — never hardcode copy. Add keys to `locales/en/translation.json` (and peer locales). Resources are bundled (synchronous, no Suspense); initial language is the OS locale (`navigator.language`), fallback English.

## Work Guidance

## Verification
`npm run typecheck && npm run lint && npm test`

## Child DOX Index
No children yet.
