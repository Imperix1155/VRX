import { describe, expect, it } from 'vitest'
import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { load } from 'js-yaml'
import { FileMatcher } from 'app-builder-lib/out/fileMatcher.js'

const config = load(readFileSync('electron-builder.yml', 'utf8'))
const root = process.cwd()
const matcher = new FileMatcher(root, '/package', (value) => value, ['**/*', ...config.files])
const filter = matcher.createFilter()
const fileStat = statSync('package.json')

describe('packaged application file boundary', () => {
  it.each([
    'coverage/index.html',
    'coverage/lcov.info',
    'test-results/result.json',
    'playwright-report/index.html',
    'scripts/example.test.mjs',
    'out/credential-probe/index.js',
    '.codex/session.json',
    '.superpowers/notes.md',
    '.fallow/cache.bin',
    '.fallow/graph-cache.bin',
    '.fallow/cache/audit-base-v9/base.bin'
  ])('excludes %s', (file) => {
    expect(filter(resolve(root, file), fileStat)).toBe(false)
  })
  it.each([
    'out/main/index.js',
    'out/preload/index.js',
    'out/renderer/index.html',
    'out/renderer/assets/main.js',
    'resources/icon.png',
    'package.json',
    'node_modules/electron-updater/out/main.js'
  ])('retains %s', (file) => {
    expect(filter(resolve(root, file), fileStat)).toBe(true)
  })
})
