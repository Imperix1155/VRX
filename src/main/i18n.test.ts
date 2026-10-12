import { afterEach, describe, expect, it } from 'vitest'
import { getMainLocale, mt, resolveMainLocale, setMainLocale } from './i18n'
import { notificationPresenter } from './friendNotifications'
import { buildTrayMenuTemplate } from './tray'
import type { FriendAlert } from './services/friendAlerts'

afterEach(() => {
  setMainLocale('en')
})

describe('main-process i18n', () => {
  it('maps Electron locales to supported languages, defaulting to English', () => {
    expect(resolveMainLocale('ja')).toBe('ja')
    expect(resolveMainLocale('ja-JP')).toBe('ja')
    expect(resolveMainLocale('JA_jp')).toBe('ja')
    expect(resolveMainLocale('en-US')).toBe('en')
    expect(resolveMainLocale('fr')).toBe('en')
    expect(resolveMainLocale('')).toBe('en')
    expect(resolveMainLocale(undefined)).toBe('en')
  })

  it('interpolates variables and leaves unknown placeholders intact', () => {
    expect(mt('notify.online.body', { name: 'Aimi' })).toBe('Aimi came online')
    expect(mt('notify.online.body')).toBe('{{name}} came online')
  })

  it('switches native copy to Japanese for a Japanese OS locale', () => {
    setMainLocale('ja-JP')
    expect(getMainLocale()).toBe('ja')
    expect(mt('notify.online.body', { name: 'Aimi' })).toBe('Aimiがオンラインになりました')
    expect(mt('recovery.reload')).toBe('再読み込み')
    const labels = buildTrayMenuTemplate({
      isVisible: false,
      onShow: () => {},
      onHide: () => {},
      onQuit: () => {}
    }).map((item) => item.label)
    expect(labels).toEqual(['VRX を表示', undefined, 'VRX を終了'])
  })

  it('localizes friend notifications, including the hot-instance plural', () => {
    setMainLocale('ja')
    const hot = {
      type: 'hot-instance',
      friendCount: 3,
      worldName: 'The Black Cat (#12345)'
    } as unknown as FriendAlert
    expect(notificationPresenter(hot)).toEqual({
      title: 'フレンドが集まっています',
      body: 'The Black Catにフレンドが3人集まっています — 参加しますか？'
    })
  })
})
