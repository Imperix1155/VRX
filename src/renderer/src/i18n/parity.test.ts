/**
 * Locale parity + key-existence scan (2026-07 audit W6).
 *
 * 1. en/ja must carry the SAME set of base keys (plural suffixes like `_one`/
 *    `_other` collapse to their base — Japanese has only the `other` CLDR
 *    category, so `key_one` legitimately exists in en alone).
 * 2. Every i18n key referenced in renderer source must exist in en — catches
 *    typos and keys deleted while still referenced. Scans string literals whose
 *    first segment is a known en top-level namespace, which covers both direct
 *    t('...') calls and the label-key lookup maps (INSTANCE_TYPE_LABEL_KEYS, …)
 *    while ignoring hostnames and paths.
 *
 * Template-literal keys (e.g. Sidebar's t(`shell.nav.${id}`)) must be mirrored
 * by quoted literals in a type-exhaustive Record. The second source scan below
 * enforces that every locale key matched by a dynamic family has such a mirror.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import en from '../locales/en/translation.json'
import ja from '../locales/ja/translation.json'

/** Flatten nested locale JSON to dot-notation keys. */
function flatten(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k
    return v !== null && typeof v === 'object' ? flatten(v as Record<string, unknown>, key) : [key]
  })
}

/** Collapse i18next plural suffixes to the base key. */
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/
const toBase = (key: string): string => key.replace(PLURAL_SUFFIX, '')

const enKeys = flatten(en)
const jaKeys = flatten(ja)
const enBase = new Set(enKeys.map(toBase))
const jaBase = new Set(jaKeys.map(toBase))

describe('locale parity (en ↔ ja)', () => {
  it('ja carries every en base key', () => {
    const missing = [...enBase].filter((k) => !jaBase.has(k))
    expect(missing).toEqual([])
  })

  it('ja has no orphan keys absent from en', () => {
    const orphans = [...jaBase].filter((k) => !enBase.has(k))
    expect(orphans).toEqual([])
  })
})

describe('key-existence scan (renderer source → en locale)', () => {
  const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
  const NAMESPACES = new Set(Object.keys(en))

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) {
        return name === 'locales' ? [] : sourceFiles(full)
      }
      return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : []
    })
  }

  // A dotted literal whose first segment is an en namespace = an i18n key ref.
  const LITERAL = /['"]([a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9_-]+)+)['"]/g
  const DYNAMIC_T = /\bt\(\s*`([^`]*)`/g

  it('every referenced key resolves in the en locale', () => {
    const missing: string[] = []
    for (const file of sourceFiles(SRC_ROOT)) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(LITERAL)) {
        const key = match[1]
        if (key === undefined) continue
        const namespace = key.split('.')[0]
        if (namespace === undefined || !NAMESPACES.has(namespace)) continue
        if (!enBase.has(toBase(key))) {
          missing.push(`${key} (${file.slice(SRC_ROOT.length + 1)})`)
        }
      }
    }
    expect(missing).toEqual([])
  })

  it('every dynamic t() family is mirrored by quoted literals for parity coverage', () => {
    const files = sourceFiles(SRC_ROOT)
    const literals = new Set<string>()
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(LITERAL)) {
        if (match[1] !== undefined) literals.add(match[1])
      }
    }

    const dynamicCoverageErrors: string[] = []
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(DYNAMIC_T)) {
        const template = match[1]
        if (template === undefined || !template.includes('${')) continue
        const pattern = new RegExp(
          `^${template
            .split(/\$\{[^}]+\}/)
            .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('[^.]+')}$`
        )
        const matchingKeys = [...enBase].filter((key) => pattern.test(key))
        if (matchingKeys.length === 0) {
          dynamicCoverageErrors.push(
            `dynamic family \`${template}\` matches no en locale keys (${file.slice(SRC_ROOT.length + 1)})`
          )
          continue
        }
        for (const key of matchingKeys) {
          if (!literals.has(key)) {
            dynamicCoverageErrors.push(`${key} (${file.slice(SRC_ROOT.length + 1)})`)
          }
        }
      }
    }

    expect(dynamicCoverageErrors).toEqual([])
  })
})
