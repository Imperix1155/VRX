/**
 * Build-time constants injected into the MAIN bundle by electron.vite.config.ts
 * (`define`), mirrored by vitest.config.ts for tests. Same mechanism as the
 * renderer's env.d.ts — the API clients build their User-Agent from this so
 * the version VRChat/CVR see always tracks the release (VRX-218 audit: the UA
 * shipped pinned at 0.1.0 while the app was at 0.10.0).
 */
declare const __APP_VERSION__: string
