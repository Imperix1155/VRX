/**
 * Names for VRChat instance language tags, which the platform now sends as
 * BCP-47 (`en`, `pt-BR`) on `dominantLanguage`, `languages` and
 * `creationLanguages`. Instance language display is not wired on this branch.
 * The sheet that shows those fields should call `languageTagLabel` so both
 * platforms' tags go through one helper.
 *
 * ⚠️ Pure values — bundled into the sandboxed renderer. No node imports.
 */

/** Well under any real tag, and past the length processors are asked to accept. */
const MAX_TAG_LENGTH = 100

function canonicalTag(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_TAG_LENGTH) {
    return null
  }
  try {
    const [tag] = Intl.getCanonicalLocales(value)
    return tag && tag.length > 0 ? tag : null
  } catch {
    return null
  }
}

/** True when `value` is one well-formed BCP-47 language tag. */
export function isBcp47LanguageTag(value: unknown): value is string {
  return canonicalTag(value) !== null
}

function languageName(locale: string, tag: string): string | null {
  let names: Intl.DisplayNames
  try {
    names = new Intl.DisplayNames([locale], { type: 'language' })
  } catch {
    return null
  }
  try {
    const label = names.of(tag)
    if (!label || label.toLowerCase() === tag.toLowerCase()) return null
    return label
  } catch {
    return null
  }
}

/**
 * The tag's name in `locale` (the app language). A tag Intl cannot name falls
 * back to its primary subtag (`pt-BR` → `pt`), then to the tag itself.
 * Returns null when `tag` is not a well-formed BCP-47 tag.
 */
export function languageTagLabel(tag: string, locale: string): string | null {
  const canonical = canonicalTag(tag)
  if (canonical === null) return null
  const displayLocale = canonicalTag(locale) ?? 'en'
  const named = languageName(displayLocale, canonical)
  if (named) return named
  const primary = canonical.split('-')[0]
  if (primary && primary !== canonical) {
    const primaryName = languageName(displayLocale, primary)
    if (primaryName) return primaryName
  }
  return tag
}
