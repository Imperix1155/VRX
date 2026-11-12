import { afterEach, describe, expect, it } from 'vitest'
import i18n from './index'
import { asTranslate, translate, type Translate } from './translate'

afterEach(async () => {
  await i18n.changeLanguage('en')
})

describe('translate', () => {
  it('reads a dynamic key from the shared catalog', () => {
    const key = 'greeting'
    expect(translate(key)).toBe('Welcome to VRX')
  })

  it('interpolates values and selects the plural form from count', () => {
    expect(translate('activity.joined', { world: 'The Hub' })).toBe('Joined The Hub')
    expect(translate('joinConfirm.peopleCount', { count: 1 })).toBe('1 person')
    expect(translate('joinConfirm.peopleCount', { count: 7 })).toBe('7 people')
  })

  it('keeps a Japanese plural on the Japanese catalog', async () => {
    await i18n.changeLanguage('ja')
    expect(translate('joinConfirm.peopleCount', { count: 1 })).toBe('1人')
    expect(translate('joinConfirm.peopleCount', { count: 7 })).toBe('7人')
  })

  it('adapts i18next t for helpers that take Translate', () => {
    const joined = (t: Translate, world: string): string => t('activity.joined', { world })
    expect(joined(asTranslate(i18n.t), 'The Hub')).toBe('Joined The Hub')
  })
})
