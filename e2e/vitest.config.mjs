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
    // `expect.poll` waits this long for the window to catch up. The default
    // of one second is too short for a busy CI runner.
    expect: { poll: { timeout: 15_000 } },
    // A slow machine can miss a step once; a real break fails twice.
    retry: 1
  }
})
