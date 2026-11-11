import { describe, expect, it } from 'vitest'
import { isBcp47LanguageTag, languageTagLabel } from './languageTag'

describe('BCP-47 language tags', () => {
  it('accepts well-formed tags, including case that Intl canonicalizes', () => {
    expect(isBcp47LanguageTag('en')).toBe(true)
    expect(isBcp47LanguageTag('pt-BR')).toBe(true)
    expect(isBcp47LanguageTag('pt-br')).toBe(true)
    expect(isBcp47LanguageTag('zh-Hans-CN')).toBe(true)
    expect(isBcp47LanguageTag('es-419')).toBe(true)
    expect(isBcp47LanguageTag('en-x-private')).toBe(true)
  })

  it('rejects values that are not a single well-formed tag', () => {
    for (const value of [
      'x',
      '',
      'en_US',
      'en-',
      'e',
      'javascript',
      'en,ja',
      ' not ',
      1,
      null,
      undefined,
      ['en']
    ]) {
      expect(isBcp47LanguageTag(value)).toBe(false)
      if (typeof value === 'string') expect(languageTagLabel(value, 'en')).toBeNull()
    }
  })

  it('names a tag in the app locale', () => {
    expect(languageTagLabel('en', 'en')).toBe('English')
    expect(languageTagLabel('pt-BR', 'en')).toBe('Brazilian Portuguese')
    expect(languageTagLabel('pt-br', 'ja')).toBe('ポルトガル語 (ブラジル)')
    expect(languageTagLabel('ja', 'en')).toBe('Japanese')
  })

  it('falls back to the primary subtag when the full tag has no name', () => {
    // DisplayNames throws on a private-use extension; the language subtag still names it.
    expect(languageTagLabel('en-x-private', 'en')).toBe('English')
    expect(languageTagLabel('en-x-private', 'ja')).toBe('英語')
  })

  it('falls back to the raw tag when neither the tag nor its primary subtag has a name', () => {
    expect(languageTagLabel('zz', 'en')).toBe('zz')
    expect(languageTagLabel('qaa', 'ja')).toBe('qaa')
  })

  it('uses English when the app locale is not itself a language tag', () => {
    expect(languageTagLabel('pt-BR', 'not a locale')).toBe('Brazilian Portuguese')
  })
})
