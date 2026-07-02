import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

/**
 * Vitest config (VRX-13; comment truth-synced in the 2026-07 audit W7)
 *
 * `environment: 'node'` is the default; component tests opt into jsdom per-file
 * via the `// @vitest-environment jsdom` header (the established pattern —
 * ErrorBoundary/LoginScreen/TopBar/DashboardView tests).
 *
 * Coverage targets (design goal): 80%+ business logic, 60%+ UI components.
 * `coverage.thresholds` are still not enforced — turning them on (with targeted
 * per-dir numbers) is tracked in the audit ledger's later items.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'scripts/**/*.{test,spec}.mjs'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: 'coverage',
      exclude: ['src/**/*.{test,spec}.ts', 'src/**/*.d.ts']
    }
  },
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@renderer': resolve('src/renderer/src')
    }
  }
})
