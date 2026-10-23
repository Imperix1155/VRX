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
    'scripts/generate-app-icons.mjs',
    'out/credential-probe/index.js',
    '.codex/session.json',
    '.superpowers/notes.md',
    '.fallow/cache.bin',
    '.fallow/graph-cache.bin',
    '.fallow/cache/audit-base-v9/base.bin',
    'README.md',
    'CHANGELOG.md',
    'AGENTS.md',
    'CLAUDE.md',
    'CONTRIBUTING.md',
    'SECURITY.md',
    'docs/DESIGN.md',
    'docs/architecture/multi-account.md',
    'scripts/release-channel.mjs',
    'scripts/assert-packaged-fonts.cjs',
    'scripts/git-hooks/pre-commit',
    '.coderabbit.yaml',
    '.fallowrc.json',
    '.gitleaks.toml',
    '.nvmrc',
    'vitest.config.ts'
  ])('excludes %s', (file) => {
    expect(filter(resolve(root, file), fileStat)).toBe(false)
  })
  it.each([
    'out/main/index.js',
    'out/preload/index.js',
    'out/renderer/index.html',
    'out/renderer/assets/main.js',
    'resources/icon.png',
    'resources/icon.ico',
    'resources/icon-16.png',
    'resources/icon-16@2x.png',
    'resources/icon-24.png',
    'resources/icon-24@2x.png',
    'package.json',
    'LICENSE',
    'node_modules/electron-updater/out/main.js',
    'node_modules/electron-updater/README.md'
  ])('retains %s', (file) => {
    expect(filter(resolve(root, file), fileStat)).toBe(true)
  })
})

describe('packaged Electron fuses', () => {
  it('pins the packaged runtime fuses', () => {
    expect(config.electronFuses).toEqual({
      runAsNode: false,
      enableNodeOptionsEnvironmentVariable: false,
      enableNodeCliInspectArguments: false,
      enableCookieEncryption: true,
      onlyLoadAppFromAsar: true,
      grantFileProtocolExtraPrivileges: true
    })
  })
})

describe('AppImage launch arguments', () => {
  it('adds no arguments to the desktop entry', () => {
    expect(config.appImage.executableArgs).toEqual([])
  })
})

describe('macOS packaging metadata', () => {
  it('declares no unused privacy usage descriptions', () => {
    expect(config.mac.extendInfo).toBeUndefined()
  })

  it('keeps the inherited entitlements minimal', () => {
    const entitlements = readFileSync('build/entitlements.mac.plist', 'utf8')
    const keys = [...entitlements.matchAll(/<key>([^<]+)<\/key>/g)].map((match) => match[1])
    expect(keys).toEqual([
      'com.apple.security.cs.allow-jit',
      'com.apple.security.cs.allow-unsigned-executable-memory'
    ])
  })
})
