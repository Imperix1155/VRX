// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { useSettingsStore } from '../stores/settings'
import i18n from '../i18n'
import RecoveryNotices, { SETTINGS_PENDING_NOTICE_DELAY_MS } from './RecoveryNotices'

const refetch = vi.fn()
let vrchatAuthError = true
vi.mock('../queries/auth', () => ({
  useAuthStatus: (platform: string) => ({
    isError: platform === 'vrchat' && vrchatAuthError,
    isFetching: false,
    refetch
  })
}))
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vrchatAuthError = true
  useSettingsStore.setState({
    settings: DEFAULT_SETTINGS,
    dirty: false,
    saveError: false,
    saving: false
  })
})
it('retains an unsaved warning and retries the latest settings without navigation', () => {
  useSettingsStore.setState({ dirty: true, saveError: true })
  render(<RecoveryNotices />)
  expect(screen.getByText(i18n.t('settings.persistence.error'))).toBeTruthy()
  const previous = useSettingsStore.getState().saveAttempt
  fireEvent.click(screen.getByRole('button', { name: i18n.t('settings.persistence.retry') }))
  expect(useSettingsStore.getState().saveAttempt).toBe(previous + 1)
  expect(screen.getByText(i18n.t('settings.persistence.error'))).toBeTruthy()
})
it('exposes a platform-specific auth failure and retry alongside usable shell content', () => {
  render(<RecoveryNotices />)
  expect(
    screen.getByText(i18n.t('settings.accounts.unreachable', { platform: 'VRChat' }))
  ).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: i18n.t('settings.accounts.retry') }))
  expect(refetch).toHaveBeenCalledOnce()
})

describe('settings persistence notice timing', () => {
  const unsaved = (): HTMLElement | null =>
    screen.queryByText(i18n.t('settings.persistence.unsaved'))

  beforeEach(() => {
    vrchatAuthError = false
    vi.useFakeTimers()
  })

  it('stays silent, with no live region, while an ordinary save is in flight', () => {
    render(<RecoveryNotices />)
    act(() => useSettingsStore.getState().updateSettings({ notifyFriendOnline: true }))
    expect(useSettingsStore.getState().dirty).toBe(true)
    expect(unsaved()).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    act(() => {
      vi.advanceTimersByTime(SETTINGS_PENDING_NOTICE_DELAY_MS - 1)
    })
    expect(unsaved()).toBeNull()
  })

  it('never shows the notice when the save settles before the delay', () => {
    render(<RecoveryNotices />)
    act(() => useSettingsStore.getState().updateSettings({ notifyFriendOnline: true }))
    act(() => {
      vi.advanceTimersByTime(300)
    })
    act(() => useSettingsStore.getState().markSaved())
    act(() => {
      vi.advanceTimersByTime(SETTINGS_PENDING_NOTICE_DELAY_MS * 2)
    })
    expect(unsaved()).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('shows a status notice once a save is still pending after the delay', () => {
    render(<RecoveryNotices />)
    act(() => useSettingsStore.getState().updateSettings({ notifyFriendOnline: true }))
    act(() => {
      vi.advanceTimersByTime(SETTINGS_PENDING_NOTICE_DELAY_MS)
    })
    expect(unsaved()).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe(i18n.t('settings.persistence.unsaved'))
    act(() => useSettingsStore.getState().markSaved())
    expect(unsaved()).toBeNull()
  })

  it('restarts the delay on each change so active editing does not show it', () => {
    render(<RecoveryNotices />)
    act(() => useSettingsStore.getState().updateSettings({ notifyFriendOnline: true }))
    act(() => {
      vi.advanceTimersByTime(SETTINGS_PENDING_NOTICE_DELAY_MS - 500)
    })
    act(() => useSettingsStore.getState().updateSettings({ notifyFriendOffline: true }))
    act(() => {
      vi.advanceTimersByTime(SETTINGS_PENDING_NOTICE_DELAY_MS - 1)
    })
    expect(unsaved()).toBeNull()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(unsaved()).toBeTruthy()
  })

  it('shows a failed save immediately as an alert, without waiting for the delay', () => {
    render(<RecoveryNotices />)
    act(() => useSettingsStore.getState().updateSettings({ notifyFriendOnline: true }))
    act(() => useSettingsStore.setState({ saveError: true }))
    expect(screen.getByRole('alert').textContent).toContain(i18n.t('settings.persistence.error'))
    expect(unsaved()).toBeNull()
  })
})
