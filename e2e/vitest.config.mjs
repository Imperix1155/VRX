import { defineConfig } from 'vitest/config'

// End-to-end tests: start the built app and click through it. They are kept
// out of `npm test` because they need `npm run build` first and a screen (on
// Linux without one: `xvfb-run -a npm run test:e2e`). See e2e/README.md.
export default defineConfig({
  test: {
    include: ['e2e/**/*.e2e.mjs'],
    environment: 'node',
    // One window at a time: each test starts a whole app.
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // A slow machine can miss a step once; a real break fails twice.
    retry: 1
  }
})
