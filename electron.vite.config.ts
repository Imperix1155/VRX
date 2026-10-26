import { readFileSync } from 'fs'
import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { devStyleCspPlugin } from './scripts/dev-style-csp'

// @shared must be aliased in ALL THREE process builds (main / preload / renderer)
// because electron-vite bundles them separately. Aliasing only the renderer would
// typecheck but fail at bundle/runtime for main + preload imports.
const shared = resolve('src/shared')

// App version injected into the renderer at build time (the sandboxed renderer can't
// read package.json). Keeps UI version strings from drifting per release — the
// sidebar footer once shipped a stale hardcoded "v0.1.0" after the 0.1.1 release.
const appVersion = (
  JSON.parse(readFileSync(resolve('package.json'), 'utf-8')) as { version: string }
).version

export default defineConfig({
  main: {
    // Externalize deps by default, EXCEPT electron-store: it is ESM-only (v12, as
    // in v11), so a require() from the CJS main bundle would throw at runtime —
    // bundle it instead (VRX-23).
    // zod is bundled for startup time: its CommonJS entry loads all 64 locale
    // files before the window can open, while the bundle keeps only the parts
    // main uses (measured ~45ms -> ~7ms of the pre-window main-process load).
    plugins: [externalizeDepsPlugin({ exclude: ['electron-store', 'zod'] })],
    // Same version injection as the renderer below (VRX-218 audit): the API
    // clients' User-Agent was hardcoded 'VRX/0.1.0' while the app shipped
    // 0.10.0 — the exact drift class the renderer define already prevents.
    // The UA is the one string the platforms identify VRX by; it must track
    // the release. (vitest.config.ts mirrors this define for tests.)
    define: {
      __APP_VERSION__: JSON.stringify(appVersion)
    },
    // Lazy externals (electron-updater, loaded after startup) load through the
    // same require() as the static ones, not Node's ESM loader.
    build: { rollupOptions: { output: { dynamicImportInCjs: false } } },
    resolve: {
      alias: {
        '@shared': shared
      }
    }
  },
  preload: {
    resolve: {
      alias: {
        '@shared': shared
      }
    }
  },
  renderer: {
    define: {
      __APP_VERSION__: JSON.stringify(appVersion)
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': shared
      }
    },
    // electron-vite leaves the renderer unminified by default. Minifying the
    // script roughly halves what the window parses at every launch (1.65 MB ->
    // 0.76 MB). keepNames keeps component and function names readable in the
    // stack that ErrorBoundary's "copy details" puts in bug reports. CSS stays
    // as Tailwind emits it: minifying it saves ~13 KB and could rewrite glass styles.
    // One local entry chunk by design (no network download), so Vite's
    // 500 kB web-download warning does not apply.
    build: { minify: true, cssMinify: false, chunkSizeWarningLimit: 1024 },
    esbuild: { keepNames: true },
    // devStyleCspPlugin: dev server only (#369); production keeps style-src 'self'.
    plugins: [react(), tailwindcss(), devStyleCspPlugin()]
  }
})
