// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { useSettingsStore } from '../stores/settings'
import { useUiStore } from '../stores/ui'
import i18n from '../i18n'
import RecoveryNotices, { SETTINGS_PENDING_NOTICE_DELAY_MS } from './RecoveryNotices'

const refetch = vi.fn()
let vrchatAuthError = true
let vrchatState = 'authenticated'
let vrchatFetching = false
let vrchatStatus = 'error'
let vrchatErrorUpdatedAt = 0
let vrchatEnded = false
let cvrState = 'authenticated'
let cvrEnded = false
vi.mock('../queries/auth', () => ({
  useAuthStatus: (platform: string) => ({
    data:
      platform === 'vrchat'
        ? { state: vrchatState, ...(vrchatEnded ? { endedByPlatform: true } : {}) }
        : { state: cvrState, ...(cvrEnded ? { endedByPlatform: true } : {}) },
    isError: platform === 'vrchat' && vrchatAuthError,
    isFetching: platform === 'vrchat' && vrchatFetching,
    status: platform === 'vrchat' ? vrchatStatus : 'success',
    errorUpdatedAt: platform === 'vrchat' ? vrchatErrorUpdatedAt : 0,
    refetch
  })
}))
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vrchatAuthError = true
  vrchatState = 'authenticated'
  vrchatFetching = false
  vrchatStatus = 'error'
  vrchatErrorUpdatedAt = 0
  vrchatEnded = false
  cvrState = 'authenticated'
  cvrEnded = false
  refetch.mockClear()
  useUiStore.setState({
    activeTab: 'dashboard',
    settingsCategory: 'appearance',
    signOutNoticeHidden: { vrchat: false, chilloutvr: false }
  })
  useSettingsStore.setState({
    settings: DEFAULT_SETTINGS,
    dirty: false,
    saveError: false,
    saving: false,
    loadFallback: false,
    newerFile: false
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
it('says the saved settings could not be read while defaults stand in for them', () => {
  vrchatAuthError = false
  useSettingsStore.setState({ loadFallback: true })
  render(<RecoveryNotices />)
  const notice = screen.getByRole('alert')
  expect(notice.textContent).toContain(i18n.t('settings.persistence.loadFallback'))
  // Nothing to retry here: the next change re-reads the file in main.
  expect(screen.queryByRole('button')).toBeNull()

  // A failed save still comes first, with its Retry.
  act(() => useSettingsStore.setState({ dirty: true, saveError: true }))
  expect(screen.getByRole('alert').textContent).toContain(i18n.t('settings.persistence.error'))
  expect(screen.queryByText(i18n.t('settings.persistence.loadFallback'))).toBeNull()

  // Once a save reaches the real file, the notice goes.
  act(() => useSettingsStore.setState({ dirty: false, saveError: false, loadFallback: false }))
  expect(screen.queryByRole('alert')).toBeNull()
})

it('says why a newer version’s settings file is not saved over, with no Retry', () => {
  vrchatAuthError = false
  useSettingsStore.setState({ dirty: true, saveError: true, newerFile: true })
  render(<RecoveryNotices />)
  expect(screen.getByRole('alert').textContent).toContain(i18n.t('settings.persistence.newerFile'))
  expect(screen.queryByRole('button')).toBeNull()
})

it('exposes a platform-specific auth failure and retry alongside usable shell content', () => {
  render(<RecoveryNotices />)
  expect(
    screen.getByText(i18n.t('settings.accounts.unreachable', { platform: 'VRChat' }))
  ).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: i18n.t('settings.accounts.retry') }))
  expect(refetch).toHaveBeenCalledOnce()
})

it('keeps keyboard focus on each Retry while it works, and ignores presses meanwhile', () => {
  vrchatFetching = true
  useSettingsStore.setState({ dirty: true, saveError: true, saving: true })
  render(<RecoveryNotices />)
  const previous = useSettingsStore.getState().saveAttempt
  for (const name of [
    i18n.t('settings.accounts.retrying'),
    i18n.t('settings.persistence.saving')
  ]) {
    const button = screen.getByRole('button', { name })
    button.focus()
    // A disabled button would drop focus to the page.
    expect(button.hasAttribute('disabled')).toBe(false)
    expect(button.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(button)
    expect(document.activeElement).toBe(button)
  }
  expect(refetch).not.toHaveBeenCalled()
  expect(useSettingsStore.getState().saveAttempt).toBe(previous)
})

it('names a VRChat session waiting for a code and opens Accounts', () => {
  vrchatAuthError = false
  vrchatState = 'needs-2fa'
  render(<RecoveryNotices />)
  const notice = screen.getByText(i18n.t('settings.accounts.needsCode', { platform: 'VRChat' }))
  expect(notice.closest('[role="status"]')).not.toBeNull()
  fireEvent.click(screen.getByRole('button', { name: i18n.t('settings.accounts.openAccounts') }))
  expect(useUiStore.getState().activeTab).toBe('settings')
  expect(useUiStore.getState().settingsCategory).toBe('accounts')
  // Accounts already shows the code prompt, so the line steps aside there.
  expect(
    screen.queryByText(i18n.t('settings.accounts.needsCode', { platform: 'VRChat' }))
  ).toBeNull()
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

it('keeps the account notice and focus on Retry while a check that failed with nothing loaded runs again', () => {
  vrchatErrorUpdatedAt = 1
  const view = render(<RecoveryNotices />)
  const retry = screen.getByRole('button', { name: i18n.t('settings.accounts.retry') })
  retry.focus()
  fireEvent.click(retry)
  expect(refetch).toHaveBeenCalledTimes(1)
  // With nothing loaded, the check running again reads as pending, not as an
  // error, until it answers.
  vrchatAuthError = false
  vrchatStatus = 'pending'
  vrchatFetching = true
  view.rerender(<RecoveryNotices />)
  expect(retry.isConnected).toBe(true)
  expect(retry.getAttribute('aria-disabled')).toBe('true')
  expect(document.activeElement).toBe(retry)
  // It fails again: the same Retry, still focused, works again.
  vrchatAuthError = true
  vrchatStatus = 'error'
  vrchatFetching = false
  view.rerender(<RecoveryNotices />)
  expect(document.activeElement).toBe(retry)
  expect(retry.hasAttribute('aria-disabled')).toBe(false)
})

describe('a platform that signed the user out by itself', () => {
  const signedOut = (platform: string): string =>
    i18n.t('settings.accounts.signedOutByPlatform', { platform })

  it('says so as an alert and opens Accounts, where the line steps aside', () => {
    vrchatAuthError = false
    vrchatState = 'unauthenticated'
    vrchatEnded = true
    render(<RecoveryNotices />)
    const notice = screen.getByRole('alert')
    expect(notice.textContent).toContain(signedOut('VRChat'))
    expect(notice.getAttribute('data-signed-out-notice')).toBe('vrchat')
    fireEvent.click(screen.getByRole('button', { name: i18n.t('settings.accounts.openAccounts') }))
    expect(useUiStore.getState().activeTab).toBe('settings')
    expect(useUiStore.getState().settingsCategory).toBe('accounts')
    expect(screen.queryByText(signedOut('VRChat'))).toBeNull()
  })

  it('names ChilloutVR the same way', () => {
    vrchatAuthError = false
    cvrState = 'unauthenticated'
    cvrEnded = true
    render(<RecoveryNotices />)
    expect(screen.getByRole('alert').textContent).toContain(signedOut('ChilloutVR'))
  })

  it('stays quiet after a sign-out the user chose', () => {
    vrchatAuthError = false
    vrchatState = 'unauthenticated'
    cvrState = 'unauthenticated'
    render(<RecoveryNotices />)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('hides on request and comes back if a later session ends the same way', () => {
    vrchatAuthError = false
    vrchatState = 'unauthenticated'
    vrchatEnded = true
    const { rerender } = render(
      <main tabIndex={-1}>
        <RecoveryNotices />
      </main>
    )
    const hide = screen.getByRole('button', {
      name: i18n.t('settings.accounts.hideSignedOut', { platform: 'VRChat' })
    })
    hide.focus()
    fireEvent.click(hide)
    expect(screen.queryByText(signedOut('VRChat'))).toBeNull()
    // Focus lands on the page, not on the document body.
    expect(document.activeElement?.tagName).toBe('MAIN')
    expect(useUiStore.getState().signOutNoticeHidden.vrchat).toBe(true)

    // Signing in again clears the mark in main, and the hidden mark resets.
    vrchatState = 'authenticated'
    vrchatEnded = false
    rerender(
      <main tabIndex={-1}>
        <RecoveryNotices />
      </main>
    )
    expect(useUiStore.getState().signOutNoticeHidden.vrchat).toBe(false)

    vrchatState = 'unauthenticated'
    vrchatEnded = true
    rerender(
      <main tabIndex={-1}>
        <RecoveryNotices />
      </main>
    )
    expect(screen.getByRole('alert').textContent).toContain(signedOut('VRChat'))
  })
})
