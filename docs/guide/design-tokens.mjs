// Rewrites the generated token reference in docs/DESIGN.md from the app's
// stylesheet: `npm run design:tokens`. With --check it only compares and
// exits 1 when the document is out of date (the docs/guide test does the same
// inside `npm test`). Node 22.18 and later run the TypeScript helper directly.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { renderDesignTokenReference, replaceDesignTokenReference } from './cssTokens.ts'

const root = fileURLToPath(new URL('../..', import.meta.url))
const cssPath = `${root}src/renderer/src/assets/main.css`
const docPath = `${root}docs/DESIGN.md`
const check = process.argv.includes('--check')

const doc = readFileSync(docPath, 'utf8')
const next = replaceDesignTokenReference(
  doc,
  renderDesignTokenReference(readFileSync(cssPath, 'utf8'))
)
if (next === null) {
  console.error('docs/DESIGN.md has no design-tokens markers.')
  process.exit(1)
}
if (next === doc) {
  console.log('docs/DESIGN.md token reference is up to date.')
} else if (check) {
  console.error('docs/DESIGN.md token reference is out of date. Run npm run design:tokens.')
  process.exit(1)
} else {
  writeFileSync(docPath, next)
  console.log('Rewrote the token reference in docs/DESIGN.md.')
}
