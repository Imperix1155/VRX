import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['electron-store'] })],
    build: {
      outDir: resolve('out/credential-probe'),
      rollupOptions: {
        input: resolve('scripts/credential-persistence-probe.ts'),
        output: {
          entryFileNames: 'index.js',
          inlineDynamicImports: true
        }
      }
    }
  }
})
