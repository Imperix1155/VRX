import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'))

describe('package-lock.json', () => {
  it('carries the same version as package.json in both root fields', () => {
    // `npm version X.Y.Z --no-git-tag-version` keeps the three in step. A
    // hand edit of package.json alone publishes a build whose lockfile lies.
    expect(lock.version).toBe(manifest.version)
    expect(lock.packages[''].version).toBe(manifest.version)
  })

  it('lists exactly the dependencies package.json declares', () => {
    expect(lock.packages[''].dependencies).toEqual(manifest.dependencies)
    expect(lock.packages[''].devDependencies).toEqual(manifest.devDependencies)
  })

  it('resolves @typescript/native to stable TypeScript 7, never a nightly', () => {
    // typescript-eslint 8.73 peers on @typescript/native at a TypeScript 7.1
    // nightly range. The direct dependency is the stable 7.0 alias `tsc` uses.
    // The override forces that optional peer onto the same alias. Without it,
    // npm nests today's nightly and `npm ci` reports the lockfile out of sync.
    const spec = 'npm:typescript@^7.0.2'
    expect(manifest.devDependencies['@typescript/native']).toBe(spec)
    expect(manifest.overrides['@typescript-eslint/typescript-estree']).toEqual({
      '@typescript/native': spec
    })

    const native = lock.packages['node_modules/@typescript/native']
    expect(native).toMatchObject({
      name: 'typescript',
      version: expect.stringMatching(/^7\.0\.\d+$/)
    })

    const nightlies = Object.entries(lock.packages).filter(([name, entry]) => {
      const version = typeof entry.version === 'string' ? entry.version : ''
      const typescriptPackage =
        name.includes('@typescript/') || name.endsWith('/typescript') || entry.name === 'typescript'
      return typescriptPackage && /-(dev|beta|rc|next|insiders)(\.|$)/.test(version)
    })
    expect(nightlies).toEqual([])
  })

  it('still names the C library of its Linux builds', () => {
    // Some npm versions on Linux rewrite the lockfile without any `libc`
    // field when you install or update a package there. Nothing fails at
    // once, the diff just loses a few dozen lines. If this test fails, undo
    // the lockfile change (`git checkout package-lock.json`) and redo the
    // install so that only the lines for your package change. See "Dependency
    // and security changes" in docs/DEVELOPMENT.md.
    const withLibc = Object.entries(lock.packages).filter(([, entry]) => Array.isArray(entry.libc))
    expect(withLibc.length).toBeGreaterThanOrEqual(10)
    for (const [name, entry] of withLibc) {
      expect(name).toMatch(/linux/)
      expect(entry.libc, name).toEqual([/musl/.test(name) ? 'musl' : 'glibc'])
    }
  })
})
