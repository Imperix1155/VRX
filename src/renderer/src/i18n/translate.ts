import type { TFunction } from 'i18next'
import i18n from './index'

/**
 * Values for `{{name}}` placeholders. A numeric `count` also selects the
 * plural form (`_one`, `_other`, …).
 */
export type TranslateValues = Record<string, unknown>

/**
 * Narrow translator for helpers and tests.
 *
 * i18next 27 types `t` as a generic overload list. A dynamic key plus an
 * optional values bag matches none of those overloads, and the list is not
 * assignable to a plain function of that shape. Pass `useTranslation().t`
 * through {@link asTranslate}. Tests call {@link translate} on the shared
 * instance.
 */
export interface Translate {
  (key: string): string
  (key: string, values: TranslateValues): string
}

/**
 * `count` has to stay a top-level option: i18next picks the plural suffix from
 * it, and a `replace` bag is interpolation data only. Everything else is
 * interpolation, which `replace` accepts without the v27 options overload.
 */
function render(t: TFunction, key: string, values: TranslateValues | undefined): string {
  if (values === undefined) return t(key)
  const count = typeof values.count === 'number' ? values.count : undefined
  return count === undefined ? t(key, { replace: values }) : t(key, { count, replace: values })
}

/** Adapt `useTranslation().t` or `i18n.t` to {@link Translate}. */
export function asTranslate(t: TFunction): Translate {
  function translateWith(key: string): string
  function translateWith(key: string, values: TranslateValues): string
  function translateWith(key: string, values?: TranslateValues): string {
    return render(t, key, values)
  }
  return translateWith
}

/** Translate a key on the shared instance. Tests use this for dynamic keys. */
export function translate(key: string, values?: TranslateValues): string {
  const t = asTranslate(i18n.t)
  return values === undefined ? t(key) : t(key, values)
}
