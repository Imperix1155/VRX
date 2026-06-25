# src/renderer — React UI

## Purpose
The renderer process: the React + Tailwind v4 UI. Runs sandboxed; reaches the main process only through the preload bridge.

## Ownership
- `index.html`, `src/main.tsx` — React entry (`main.tsx` also initializes i18next).
- `src/components/ErrorBoundary.tsx` — React error boundary (VRX-127). Wraps `<App/>` in `main.tsx` (inside `QueryClientProvider`) AND each panel (e.g. `FriendsList` in `App.tsx`). Catches render-phase errors from its subtree and shows a glass-styled fallback (`--error` token + non-color glyph + Reload + Copy-diagnostics, all copy i18n'd). A `variant` prop (VRX-165) controls the fallback: `'app'` (default) is full-screen with the brand mark; `'panel'` is compact (no `min-h-screen`, no brand mark) so a single panel's error doesn't blank the whole window — the per-panel boundary passes `variant="panel"`. `componentDidCatch` logs to `electron-log/renderer`, which forwards to the main process via the IPC bridge wired by `initLogger()` — no new IPC channels needed. Tested via `@testing-library/react` + `// @vitest-environment jsdom` (the jsdom environment is required because React error boundaries only fire during the client commit phase). `@testing-library/react` was added to devDependencies for this purpose; `.tsx` component tests that need a real DOM use the `// @vitest-environment jsdom` header to opt in.
- `src/App.tsx`, `src/components/` — UI components. `App.tsx` is the **auth gate** (VRX-158): reads `useAuthStatus` and renders `LoginScreen` unless authenticated (blank while the check is pending, so an already-signed-in session doesn't flash the form), otherwise the **§8 `AppShell`**. `LoginScreen.tsx` (VRX-158) — username/password → `window.vrx.login`, then a method-aware 2FA prompt → `window.vrx.verify2fa` for the second leg (the password is dropped from state once 2FA is requested, VRX-159); glass card with VRChat blue tint, errors via the `--error` token + a non-color glyph, all copy i18n'd; bridge/login failures are surfaced (never a silent no-op). **App shell (VRX-168, §8):** `AppShell.tsx` (248px sidebar | 1fr main; only `.main` scrolls), `Sidebar.tsx` (tri-color VRX brand + 6-item nav with active glass fill + `--vrc→--cvr` spine + footer), `TopBar.tsx` (view title + glass segmented All/V/C control + online-count stub); view switching via the `ui` store. (The throwaway `TokenPreview`/`LocaleProbe` were deleted here.) **`FriendsList.tsx`** (VRX-19/21/164/166) renders the §235 friend row: per-row `PlatformSpine` (3px glowing `--vrc`/`--cvr` edge), `PlatformGlyph` (V/C VT323 badge), name + VRChat status pill, and a subline of world + `OpennessIcon` (§6 neutral-gray icon badge) — except Ask-Me/DND, which hide the world and show the custom status instead (`isWorldHidden`). Avatar column, Join affordance, and trust pill remain deferred (VRX-48 / `joinInstance` / a settings toggle).
- `src/i18n/` — i18next + react-i18next setup (VRX-14): bundled resources, OS-locale detection via `navigator.language`, English fallback.
- `src/locales/<lng>/translation.json` — translation resources (`en`, `ja`). All user-visible strings must be keyed here.
- `src/assets/main.css` — Tailwind import + the VRX design tokens (§2 dark `:root`, §2A light `[data-theme="light"]`).
- `src/stores/` — Zustand stores, one per domain; each independently testable, and **no store imports another** (compose at the view layer). Guard `window.vrx` (undefined in Preview/test) in any IPC-backed fetch. (VRX-19/21)
  - `friends.ts` — **view state only**: `search` / `platformFilter` / `selectedFriendId` (filtering happens in the view). Server friends data lives in the TanStack Query cache (`queries/friends.ts`), NOT here (VRX-22).
  - `settings.ts` — `Settings` seeded from `@shared/settings` `DEFAULT_SETTINGS` + a `dirty` flag. In-memory only until the `get-settings` / `save-settings` IPC lands (persistence-pending).
  - `accounts.ts` — `accounts[]` via `get-accounts` (`[]` until VRX-24); `activeAccount(platform)` derived from `Account.isActive` (no separate active-id state).
  - `ui.ts` — ephemeral view state ONLY: `activeTab` now drives the **§8 shell nav / active view** (Dashboard/Activity/Friends/Instances/Groups/Settings, VRX-168), plus `drawerOpen`. Persisted prefs like `density` live in `settings.ts`, never here.
  - notifications store deferred — no `Notification` type or IPC channel exists yet (M3).
- `src/queries/` — TanStack Query layer (VRX-22): the source of truth for server state; Zustand stores hold only view state. `queryClient.ts` (shared client — no refetch-on-focus, retry+backoff, per VRX's rate-limit etiquette); `friends.ts` (`useFriends` hook + pure `friendsQueryKey` / `fetchFriends`; SWR via `staleTime`+`refetchInterval`=`FRIENDS_RECONCILE_MS`, the slow reconcile — the WS, not polling, is the live path); `auth.ts` (`useAuthStatus` — invalidation-driven, NO polling; drives the auth gate, VRX-158). Wrapped at the root via `QueryClientProvider` in `main.tsx`.
- `src/utils/` — `loginError.ts` (maps VrcAdapter login error codes → i18n keys; unknown → a generic message, never surfaces the raw code; VRX-158). `src/hooks`, `routes` — empty placeholders until features land.

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
