import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  isReady: vi.fn(() => true),
  getLocale: vi.fn(() => 'en-US'),
  showErrorBox: vi.fn()
}))

vi.mock('electron', () => ({
  app: { isReady: electron.isReady, getLocale: electron.getLocale },
  dialog: { showErrorBox: electron.showErrorBox }
}))

import { showFatalErrorBox } from './fatalErrorBox'
import { setMainLocale } from './i18n'

beforeEach(() => {
  electron.isReady.mockReturnValue(true)
  electron.getLocale.mockReturnValue('en-US')
  electron.showErrorBox.mockReset()
})

afterEach(() => setMainLocale('en'))

it('shows a localized startup error box without error details', () => {
  electron.getLocale.mockReturnValue('ja-JP')
  showFatalErrorBox('startup')
  expect(electron.showErrorBox).toHaveBeenCalledWith(
    'VRX を起動できませんでした',
    'VRX の起動中に問題が発生しました。もう一度開いてみてください。'
  )
})

it('uses the runtime copy for a fatal error after startup', () => {
  showFatalErrorBox('runtime')
  expect(electron.showErrorBox).toHaveBeenCalledWith(
    'VRX has to close',
    'Something went wrong and VRX has to close. Open it again to continue.'
  )
})

it('falls back to English before ready instead of reading the locale', () => {
  electron.isReady.mockReturnValue(false)
  showFatalErrorBox('startup')
  expect(electron.getLocale).not.toHaveBeenCalled()
  expect(electron.showErrorBox).toHaveBeenCalledWith(
    'VRX failed to start',
    'Something went wrong while VRX was starting. Try opening it again.'
  )
})

it('never throws when the dialog itself fails', () => {
  electron.showErrorBox.mockImplementation(() => {
    throw new Error('no display')
  })
  expect(() => showFatalErrorBox('runtime')).not.toThrow()
})
