import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

const root = resolve(import.meta.dirname, '../..')
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
  version: string
}
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()

export default defineConfig({
  root: resolve(root, 'docs'),
  base: './',
  plugins: [tailwindcss()],
  esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
  define: {
    __APP_VERSION__: JSON.stringify(manifest.version),
    __GUIDE_REVISION__: JSON.stringify(revision)
  },
  resolve: {
    alias: {
      '@renderer': resolve(root, 'src/renderer/src'),
      '@shared': resolve(root, 'src/shared')
    }
  },
  server: { host: '127.0.0.1', port: 4173, strictPort: true, fs: { allow: [root] } },
  preview: { host: '127.0.0.1', port: 4174, strictPort: true },
  build: {
    outDir: resolve(root, 'dist/design-guide'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        design: resolve(root, 'docs/design.html'),
        glass: resolve(root, 'docs/glass.html')
      }
    }
  }
})
