import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// @shared must be aliased in ALL THREE process builds (main / preload / renderer)
// because electron-vite bundles them separately. Aliasing only the renderer would
// typecheck but fail at bundle/runtime for main + preload imports.
const shared = resolve('src/shared')

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
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': shared
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
