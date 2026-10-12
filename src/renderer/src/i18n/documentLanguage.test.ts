// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import i18n from './index'

describe('document language', () => {
  it('mirrors the resolved UI language onto <html lang>', async () => {
    expect(document.documentElement.lang).toBe(i18n.resolvedLanguage)
    await i18n.changeLanguage('ja')
    expect(document.documentElement.lang).toBe('ja')
    await i18n.changeLanguage('fr')
    expect(document.documentElement.lang).toBe('en')
    await i18n.changeLanguage('en')
  })
})
