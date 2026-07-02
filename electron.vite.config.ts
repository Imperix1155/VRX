import { readFileSync } from 'fs'
import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

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
    // Externalize deps by default, EXCEPT electron-store: it is ESM-only (v11), so a
    // require() from the CJS main bundle would throw at runtime — bundle it instead (VRX-23).
    plugins: [externalizeDepsPlugin({ exclude: ['electron-store'] })],
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
    plugins: [react(), tailwindcss()]
  }
})
