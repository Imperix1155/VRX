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
 * KNOWN BLIND SPOT: template-literal keys (e.g. Sidebar's t(`shell.nav.${id}`))
 * are invisible to the quoted-literal regex. Today that family is backstopped
 * by viewTitles.ts holding all six keys as quoted literals in a type-exhaustive
 * Record — if you add a NEW dynamic-key call site, mirror its keys in a quoted
 * literal map so this scan keeps covering them.
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

  it('every referenced key resolves in the en locale', () => {
    const missing: string[] = []
    for (const file of sourceFiles(SRC_ROOT)) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(LITERAL)) {
        const key = match[1]
        if (!NAMESPACES.has(key.split('.')[0])) continue
        if (!enBase.has(toBase(key))) {
          missing.push(`${key} (${file.slice(SRC_ROOT.length + 1)})`)
        }
      }
    }
    expect(missing).toEqual([])
  })
})
