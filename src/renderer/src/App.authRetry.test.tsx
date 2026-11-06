// @vitest-environment jsdom
/**
 * The account notice's Retry through the real App gate, the real auth query and
 * a real QueryClient. VRChat's check fails with nothing loaded; ChilloutVR is
 * signed out, so the failed check alone keeps the shell up. Running the check
 * again reads as pending, not as an error, until it answers.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/settings'
import type { AuthStatus, Platform } from '@shared/types'
import App from './App'
import i18n from './i18n'
import { useSettingsStore } from './stores/settings'

vi.mock('./components/AppShell', async () => {
  const { default: RecoveryNotices } = await import('./components/RecoveryNotices')
  return {
    default: () => (
      <div data-testid="app-shell">
        <RecoveryNotices />
      </div>
    )
  }
})

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  })
})

afterEach(() => {
  cleanup()
  Object.assign(window, { vrx: undefined })
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS, dirty: false, hydrated: false })
})

it('keeps the shell, the account notice and focus on Retry while a failed check runs again, with one platform signed in', async () => {
  let failAgain: () => void = () => undefined
  let vrchatChecks = 0
  const signedOut: AuthStatus = {
    platform: 'chilloutvr',
    state: 'unauthenticated',
    accountId: null,
    displayName: null
  }
  Object.assign(window, {
    vrx: {
      getSettings: vi.fn().mockResolvedValue({ ...DEFAULT_SETTINGS, setupPending: false }),
      getAuthStatus: vi.fn(({ platform }: { platform: Platform }) => {
        if (platform === 'chilloutvr') return Promise.resolve(signedOut)
        vrchatChecks++
        if (vrchatChecks === 1) return Promise.reject(new Error('check failed'))
        return new Promise<AuthStatus>((_, reject) => {
          failAgain = () => reject(new Error('check failed again'))
        })
      })
    }
  })
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <App />
    </QueryClientProvider>
  )
  const retry = await screen.findByRole('button', { name: i18n.t('settings.accounts.retry') })
  retry.focus()
  fireEvent.click(retry)

  await waitFor(() => expect(retry.textContent).toBe(i18n.t('settings.accounts.retrying')))
  expect(vrchatChecks).toBe(2)
  expect(screen.getByTestId('app-shell')).toBeTruthy()
  expect(screen.queryByText(i18n.t('boot.connecting'))).toBeNull()
  expect(retry.isConnected).toBe(true)
  expect(retry.getAttribute('aria-disabled')).toBe('true')
  expect(document.activeElement).toBe(retry)

  await act(async () => failAgain())
  await waitFor(() => expect(retry.textContent).toBe(i18n.t('settings.accounts.retry')))
  expect(retry.isConnected).toBe(true)
  expect(retry.hasAttribute('aria-disabled')).toBe(false)
  expect(document.activeElement).toBe(retry)
})
