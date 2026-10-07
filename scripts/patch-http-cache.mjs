import { createHash } from 'node:crypto'
import { readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const originalHash = '01b7d66c854b2fe53ac05c98feb6e0d64722ab8898a778e2d2426a8b468d178f'
const patchedHash = '575c2ab8281d6f884fed7abf5262920e262900f557811e0773f1d4f36b662a3a'
const digest = (source) => createHash('sha256').update(source).digest('hex')

// GHSA-ch52-4w7c-c8xp: security prohibitions must survive all stale reuse paths.
// Keep the upstream public/immutable cookie opt-ins and private-cache semantics.
const guard = `    _vrxAllowsReuse() {
        return this.storable() &&
            !this._rescc['no-cache'] &&
            !this._rescc['must-revalidate'] &&
            this._resHeaders.vary !== '*' &&
            !(this._isShared && (
                this._rescc['proxy-revalidate'] ||
                (this._resHeaders['set-cookie'] && !this._rescc.public && !this._rescc.immutable)
            ));
    }

`

export function patchedSource(source) {
  if (digest(source) === patchedHash) return source
  if (digest(source) !== originalHash)
    throw new Error('Unexpected http-cache-semantics source; review required')
  return source
    .replace('    evaluateRequest(req) {', `${guard}    evaluateRequest(req) {`)
    .replace("if (this._rescc['must-revalidate']) {", 'if (!this._vrxAllowsReuse()) {')
    .replace(
      '    _useStaleIfError() {',
      '    _useStaleIfError() {\n        if (!this._vrxAllowsReuse()) return false;'
    )
    .replace(
      '    useStaleWhileRevalidate() {',
      '    useStaleWhileRevalidate() {\n        if (!this._vrxAllowsReuse()) return false;'
    )
}

export function patchHttpCache(checkOnly = false) {
  const target = require.resolve('http-cache-semantics')
  const manifest = require('http-cache-semantics/package.json')
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'))
  const copies = Object.entries(lock.packages).filter(([path]) =>
    path.endsWith('node_modules/http-cache-semantics')
  )
  if (
    manifest.version !== '4.2.0' ||
    copies.length !== 1 ||
    copies[0][0] !== 'node_modules/http-cache-semantics' ||
    copies[0][1].version !== '4.2.0' ||
    copies[0][1].dev !== true
  ) {
    throw new Error('Unexpected http-cache-semantics graph; review required')
  }
  const builder = createRequire(require.resolve('app-builder-lib/package.json'))
  const downloader = createRequire(builder.resolve('@electron/get'))
  const got = createRequire(downloader.resolve('got'))
  const adapter = createRequire(got.resolve('cacheable-request'))
  if (adapter.resolve('http-cache-semantics') !== target) {
    throw new Error('Builder uses an unexpected HTTP cache copy; review required')
  }
  const source = readFileSync(target, 'utf8')
  if (checkOnly) {
    if (digest(source) !== patchedHash)
      throw new Error('HTTP cache security patch missing; run npm ci')
  } else {
    const patched = patchedSource(source)
    if (digest(patched) !== patchedHash) throw new Error('HTTP cache patch output mismatch')
    if (patched !== source) writeFileSync(target, patched)
  }
}

if (
  process.argv[1] &&
  realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])
) {
  patchHttpCache(process.argv.includes('--check'))
}
