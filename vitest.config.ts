import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

/**
 * Vitest config (VRX-13)
 *
 * `environment: 'node'` — current tests cover pure logic (e.g. redact.ts). When real
 * UI components land, add a separate jsdom test project (do NOT switch globally).
 *
 * Coverage targets (design goal): 80%+ business logic, 60%+ UI components. These are
 * NOT enforced as `thresholds` yet — most of the codebase is bootstrap/preview and not
 * meaningfully unit-testable. Turn on `coverage.thresholds` once real business logic
 * exists so CI doesn't fail on day-one emptiness.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
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
