// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useSettingsStore } from '../stores/settings'
import i18n from '../i18n'
import RecoveryNotices from './RecoveryNotices'

const refetch = vi.fn()
vi.mock('../queries/auth', () => ({
  useAuthStatus: (platform: string) => ({
    isError: platform === 'vrchat',
    isFetching: false,
    refetch
  })
}))
afterEach(() => {
  cleanup()
  useSettingsStore.setState({ dirty: false, saveError: false, saving: false })
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
