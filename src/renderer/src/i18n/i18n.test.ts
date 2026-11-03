import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import i18n from './index'

// Exercises the i18n instance directly under the node env (no jsdom). Component
// rendering with useTranslation gets its own jsdom test project when real UI tests
// land, per vitest.config.ts.
describe('i18n', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('renders a string via t() in the default (English) language', () => {
    expect(i18n.t('greeting')).toBe('Welcome to VRX')
  })

  it('changes rendered text when the language switches', async () => {
    await i18n.changeLanguage('ja')
    expect(i18n.t('greeting')).toBe('VRXへようこそ')
  })

  it('falls back to English for an unsupported language', async () => {
    await i18n.changeLanguage('xx')
    expect(i18n.t('greeting')).toBe('Welcome to VRX')
    // Times and numbers are formatted with i18n.language, so it says English too.
    expect(i18n.language).toBe('en')
  })
})

describe('start-up language', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each([
    ['de-DE', 'en'],
    ['ko-KR', 'en'],
    ['ja-JP', 'ja'],
    ['en-GB', 'en']
  ])('an OS set to %s starts in %s, times and numbers included', async (osLocale, expected) => {
    vi.resetModules()
    vi.stubGlobal('navigator', { language: osLocale })
    const { default: started } = await import('./index')
    expect(started.language).toBe(expected)
    expect(started.resolvedLanguage).toBe(expected)
  })
})
