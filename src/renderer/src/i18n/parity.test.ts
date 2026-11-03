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

describe('unofficial-app notice', () => {
  // ChilloutVR's terms (§8) require this sentence word for word in third-party
  // apps; see docs/api-policy.md.
  const CVR_DISCLAIMER =
    'This application is not created by or affiliated with ChilloutVR or the ChilloutVR team in any way.'

  it('keeps ChilloutVR’s required disclaimer word for word in en', () => {
    expect(en.settings.legal.chilloutvr).toBe(CVR_DISCLAIMER)
  })
})

describe('Japanese terms', () => {
  function texts(obj: Record<string, unknown>): string[] {
    return Object.values(obj).flatMap((value) =>
      value !== null && typeof value === 'object'
        ? texts(value as Record<string, unknown>)
        : [String(value)]
    )
  }
  const all = texts(ja)

  it('calls Identities アカウントの関連付け everywhere, as its button and title do', () => {
    expect(ja.linking.identities).toBe('アカウントの関連付け')
    expect(all.filter((text) => text.includes('アカウント管理'))).toEqual([])
  })

  it('calls a friend request フレンドリクエスト everywhere, as the Inbox does', () => {
    expect(all.filter((text) => text.includes('フレンド申請'))).toEqual([])
    // The button's words stay part of its full name for screen readers.
    expect(ja.friendActions.addAria).toContain(ja.friendActions.add)
  })

  it('calls Hot Instances ホットインスタンス everywhere; 人気 is Popular now', () => {
    expect(all.filter((text) => text.includes('人気インスタンス'))).toEqual([])
  })

  it('calls published worlds 公開ワールド, as Popular now does', () => {
    expect(all.filter((text) => text.includes('パブリックワールド'))).toEqual([])
  })

  it('calls the instance words インスタンスラベル, as the setting does', () => {
    expect(ja.settings.labelScheme.label).toBe('インスタンスラベル')
    expect(all.filter((text) => /インスタンスピル|インスタンスのタグ/.test(text))).toEqual([])
  })
})

describe('English terms', () => {
  function texts(obj: Record<string, unknown>): string[] {
    return Object.values(obj).flatMap((value) =>
      value !== null && typeof value === 'object'
        ? texts(value as Record<string, unknown>)
        : [String(value)]
    )
  }

  it('calls the instance words instance labels, as the setting does', () => {
    expect(en.settings.labelScheme.label).toBe('Instance labels')
    expect(texts(en).filter((text) => /instance (pills|tags)/i.test(text))).toEqual([])
  })
})

describe('counts', () => {
  it.each([
    ['en', 'Offline (1,200)', '1,234'],
    ['ja', 'オフライン (1,200)', '1,234']
  ] as const)('%s: friend counts of a thousand or more are grouped', async (lang, offline, top) => {
    const { default: i18n } = await import('./index')
    const t = i18n.getFixedT(lang)
    expect(t('friends.section.offline', { count: 1200 })).toBe(offline)
    expect(t('shell.friendCount', { count: 1234 })).toContain(top)
    expect(t('shell.counts.friendsOnline', { count: 1234 })).toContain(top)
    expect(t('linking.people', { count: 1234 })).toContain(top)
    expect(t('avatars.uploadCount', { count: 1234 })).toContain(top)
  })

  it('en: the grouped number still picks the singular or plural', async () => {
    const { default: i18n } = await import('./index')
    const t = i18n.getFixedT('en')
    expect(t('shell.friendCount', { count: 1 })).toBe('<b>1</b> friend')
    expect(t('shell.friendCount', { count: 1234 })).toBe('<b>1,234</b> friends')
    expect(t('shell.counts.friendsOnline', { count: 1 })).toBe('1 friend online')
    expect(t('shell.counts.friendsOnline', { count: 1234 })).toBe('1,234 friends online')
    expect(t('linking.people', { count: 1 })).toBe('1 person')
    expect(t('avatars.uploadCount', { count: 1234 })).toBe('1,234 avatars')
  })
})

// A control's spoken name holds the words it shows (WCAG 2.5.3), so speech
// users can say what they see.
describe('names that hold their visible words', () => {
  it.each([
    ['en', en],
    ['ja', ja]
  ] as const)('%s: the Join pills start with their access words', (_lang, bundle) => {
    expect(bundle.friends.joinPillAria.startsWith('{{access}}')).toBe(true)
  })

  it.each([
    ['en', en],
    ['ja', ja]
  ] as const)('%s: Add friend says its button words', (_lang, bundle) => {
    expect(bundle.friendActions.addAria.toLowerCase()).toContain(
      bundle.friendActions.add.toLowerCase()
    )
  })

  it.each([
    ['en', en],
    ['ja', ja]
  ] as const)('%s: world cards, Wear and Set as home world say their words', (_lang, bundle) => {
    expect(bundle.explore.openWorldAria).toContain(bundle.explore.viewRooms)
    expect(bundle.avatars.sheet.wearAria).toContain(bundle.avatars.sheet.wear)
    expect(bundle.explore.home.setAria).toContain(bundle.explore.home.set)
    // English starts with them; Japanese puts the verb last, as for Add friend.
    if (bundle === en) {
      expect(en.avatars.sheet.wearAria.startsWith(en.avatars.sheet.wear)).toBe(true)
      expect(en.explore.home.setAria.startsWith(en.explore.home.set)).toBe(true)
      expect(en.explore.openWorldAria.startsWith('{{world}}')).toBe(true)
    }
  })
})

describe('Settings controls named with the words they show', () => {
  const settingsView = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../components/SettingsView.tsx'),
    'utf8'
  )
  const named = [
    ...new Set([...settingsView.matchAll(/t\('([a-zA-Z.]+)\.aria'\)/g)].map((match) => match[1]))
  ].filter((key): key is string => key !== undefined)
  const entry = (bundle: unknown, key: string): { label?: unknown; aria?: unknown } =>
    key
      .split('.')
      .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], bundle) ?? {}

  it.each([
    ['en', en],
    ['ja', ja]
  ] as const)('%s: each spoken name holds its visible label', (_lang, bundle) => {
    const misses = named.flatMap((key) => {
      const { label, aria } = entry(bundle, key)
      if (typeof label !== 'string' || typeof aria !== 'string') return []
      return aria.toLowerCase().includes(label.toLowerCase()) ? [] : [`${key}: ${aria}`]
    })
    expect(named.length).toBeGreaterThan(15)
    expect(misses).toEqual([])
  })
})
