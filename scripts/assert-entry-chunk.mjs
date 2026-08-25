// VRX-230 build-shape guardrail — runs after every `electron-vite build`.
//
// The single-instance protection is not just source code: it depends on the
// BUILD emitting a minimal entry chunk (out/main/index.js, requiring only
// electron) that defers the heavy app chunk behind the lock verdict via a
// dynamic import. If a bundler config change (e.g. inlineDynamicImports) ever
// folds the app chunk back into the entry, every duplicate launch would
// evaluate the full app (logger, safeStorage/keychain reads, ws init) BEFORE
// the lock verdict — with every source-level test still green. This assertion
// is the only check that guards the emitted shape (Kimi review, VRX-230).
import { readFileSync, readdirSync } from 'node:fs'

const fail = (message) => {
  console.error(`assert-entry-chunk: ${message}`)
  process.exit(1)
}

const entry = readFileSync('out/main/index.js', 'utf8')
const appChunks = readdirSync('out/main').filter((f) => /^app-.*\.js$/.test(f))
const rendererAssets = readdirSync('out/renderer/assets')

if (appChunks.length !== 1) {
  fail(`expected exactly one out/main/app-*.js chunk, found ${appChunks.length}`)
}
if (!/require\("\.\/app-/.test(entry)) {
  fail('entry never defer-requires the app chunk — the dynamic import is gone')
}
for (const dep of ['electron-log', 'electron-updater', 'ws', 'zod', 'electron-store']) {
  if (entry.includes(`"${dep}"`)) {
    fail(
      `entry chunk requires "${dep}" — the app chunk was inlined; duplicates would evaluate the full app before the lock verdict (VRX-230)`
    )
  }
}

for (const font of ['inter-latin-wght-normal', 'vt323-latin-400-normal']) {
  if (!rendererAssets.some((asset) => asset.startsWith(`${font}-`) && asset.endsWith('.woff2'))) {
    fail(`renderer bundle is missing ${font}-*.woff2`)
  }
}

console.log('assert-entry-chunk: OK — entry minimal, app chunk deferred, renderer fonts bundled')
