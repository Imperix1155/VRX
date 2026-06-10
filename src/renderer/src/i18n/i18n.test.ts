import { describe, it, expect, beforeEach } from 'vitest'
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
  })
})
