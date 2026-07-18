// @vitest-environment jsdom
/**
 * Auth-gate routing tests (VRX-173) + settings hydration gate (VRX-212).
 *
 * Pins the two-platform gate: pending-with-no-known-session → blank; either
 * authenticated → AppShell; neither authenticated → LoginScreen, preserving the
 * direct method-aware VRChat 2FA reprompt when CVR is disconnected.
 * AppShell is stubbed because its full tree is covered by component tests.
 *
 * VRX-212: the UI also stays blank until the persisted-settings load has
 * resolved, so a saved non-default theme/glow is applied before anything
 * visible renders.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, cleanup, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DEFAULT_SETTINGS, type Settings } from '@shared/settings'
import type { AuthStatus, Platform } from '@shared/types'
import i18n from './i18n'
import App from './App'
import { useSettingsStore } from './stores/settings'
import { useUiStore } from './stores/ui'

const useAuthStatusMock = vi.hoisted(() => vi.fn())
vi.mock('./queries/auth', () => ({
  useAuthStatus: useAuthStatusMock,
  authStatusQueryKey: (platform: string = 'vrchat') => ['auth-status', platform]
}))
// AppShell drags in the whole shell tree — stub it; the gate is what's under test.
vi.mock('./components/AppShell', () => ({
  default: () => <div data-testid="app-shell" />
}))

const msg = (key: string): string => i18n.t(key)

function mockAuthStatuses(
  vrchat: AuthStatus,
  chilloutvr: AuthStatus,
  pending: Platform[] = []
): void {
  useAuthStatusMock.mockImplementation((platform: Platform = 'vrchat') => ({
    data: platform === 'vrchat' ? vrchat : chilloutvr,
    isPending: pending.includes(platform)
  }))
}

const vrcUnauthenticated: AuthStatus = {
  platform: 'vrchat',
  state: 'unauthenticated',
  accountId: null,
  displayName: null
}
const cvrUnauthenticated: AuthStatus = {
  platform: 'chilloutvr',
  state: 'unauthenticated',
  accountId: null,
  displayName: null
}

function renderApp(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  )
}

/** A promise with its resolver exposed, for hand-driven async ordering. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function stubSettingsLoad(promise: Promise<Settings>): void {
  Object.assign(window, {
    vrx: {
      getSettings: () => promise
    }
  })
}

let navigateToDashboard: (() => void) | undefined

function stubDashboardNavigation(): void {
  Object.assign(window, {
    vrx: {
      getSettings: () => Promise.resolve({ ...DEFAULT_SETTINGS }),
      onNavigateToDashboard: (callback: () => void) => {
        navigateToDashboard = callback
        return () => {
          navigateToDashboard = undefined
        }
      }
    }
  })
}

beforeEach(() => {
  // useApplyTheme reads matchMedia; jsdom does not provide it.
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
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-glow')
})

afterEach(() => {
  cleanup()
  useAuthStatusMock.mockReset()
  navigateToDashboard = undefined
  Object.assign(window, { vrx: undefined })
  useUiStore.setState({ activeTab: 'dashboard' })
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS, dirty: false, hydrated: false })
})

describe('App auth gate (VRX-173, platform parity)', () => {
  it('routes VRChat needs-2fa to LoginScreen when CVR is disconnected', () => {
    mockAuthStatuses(
      {
        platform: 'vrchat',
        state: 'needs-2fa',
        accountId: null,
        displayName: null,
        twoFactorMethod: 'email'
      },
      cvrUnauthenticated
    )
    renderApp()

    expect(screen.getByText(msg('login.twoFactor.promptEmail'))).toBeTruthy()
    expect(screen.queryByLabelText(msg('login.password'))).toBeNull()
  })

  it('falls back to totp copy when needs-2fa carries no method', () => {
    mockAuthStatuses(
      { platform: 'vrchat', state: 'needs-2fa', accountId: null, displayName: null },
      cvrUnauthenticated
    )
    renderApp()

    expect(screen.getByText(msg('login.twoFactor.promptTotp'))).toBeTruthy()
  })

  it('shows the credentials form when both platforms are unauthenticated', () => {
    mockAuthStatuses(vrcUnauthenticated, cvrUnauthenticated)
    renderApp()

    expect(screen.getByLabelText(msg('login.username'))).toBeTruthy()
  })

  it('renders the shell when VRChat alone is authenticated', () => {
    mockAuthStatuses(
      { platform: 'vrchat', state: 'authenticated', accountId: 'usr_neo', displayName: 'Neo' },
      cvrUnauthenticated
    )
    renderApp()

    expect(screen.getByTestId('app-shell')).toBeTruthy()
  })

  it('renders the shell when CVR alone remains authenticated after VRChat disconnects', () => {
    mockAuthStatuses(vrcUnauthenticated, {
      platform: 'chilloutvr',
      state: 'authenticated',
      accountId: 'cvr_trinity',
      displayName: 'Trinity'
    })
    renderApp()

    expect(screen.getByTestId('app-shell')).toBeTruthy()
  })

  it('renders the shell for VRChat needs-2fa when CVR is authenticated', () => {
    mockAuthStatuses(
      {
        platform: 'vrchat',
        state: 'needs-2fa',
        accountId: null,
        displayName: null,
        twoFactorMethod: 'totp'
      },
      {
        platform: 'chilloutvr',
        state: 'authenticated',
        accountId: 'cvr_trinity',
        displayName: 'Trinity'
      }
    )
    renderApp()

    expect(screen.getByTestId('app-shell')).toBeTruthy()
    expect(screen.queryByText(msg('login.twoFactor.promptTotp'))).toBeNull()
  })

  it.each(['vrchat', 'chilloutvr'] as const)(
    'renders the shell (NOT LoginScreen) when %s is in error and neither is authenticated',
    (errorPlatform) => {
      // VRX-201: `error` means the platform couldn't be reached / its reply
      // couldn't be read — the session may be ALIVE. Falling to LoginScreen
      // here invites re-entering credentials → duplicate sessions.
      const errored: AuthStatus = {
        platform: errorPlatform,
        state: 'error',
        accountId: null,
        displayName: null
      }
      mockAuthStatuses(
        errorPlatform === 'vrchat' ? errored : vrcUnauthenticated,
        errorPlatform === 'chilloutvr' ? errored : cvrUnauthenticated
      )
      renderApp()

      expect(screen.getByTestId('app-shell')).toBeTruthy()
      expect(screen.queryByLabelText(msg('login.username'))).toBeNull()
    }
  )

  it('renders nothing while either unresolved platform could still be authenticated', () => {
    mockAuthStatuses(vrcUnauthenticated, cvrUnauthenticated, ['chilloutvr'])
    renderApp()

    expect(screen.queryByLabelText(msg('login.username'))).toBeNull()
    expect(screen.queryByTestId('app-shell')).toBeNull()
  })

  it('routes a native hot-instance toast click to the Dashboard', () => {
    stubDashboardNavigation()
    useUiStore.setState({ activeTab: 'settings' })
    mockAuthStatuses(
      { platform: 'vrchat', state: 'authenticated', accountId: 'usr_neo', displayName: 'Neo' },
      cvrUnauthenticated
    )
    renderApp()

    act(() => navigateToDashboard?.())

    expect(useUiStore.getState().activeTab).toBe('dashboard')
  })
})

describe('App settings hydration gate (VRX-212)', () => {
  it('hydrates immediately and renders normally when the preload bridge is absent', async () => {
    mockAuthStatuses(
      { platform: 'vrchat', state: 'authenticated', accountId: 'usr_neo', displayName: 'Neo' },
      cvrUnauthenticated
    )
    renderApp()

    await waitFor(() => expect(useSettingsStore.getState().hydrated).toBe(true))
    expect(screen.getByTestId('app-shell')).toBeTruthy()
  })

  it('renders blank while settings load, even when auth would already show the shell', async () => {
    const load = deferred<Settings>()
    stubSettingsLoad(load.promise)
    mockAuthStatuses(
      { platform: 'vrchat', state: 'authenticated', accountId: 'usr_neo', displayName: 'Neo' },
      cvrUnauthenticated
    )
    renderApp()

    expect(useSettingsStore.getState().hydrated).toBe(false)
    expect(screen.queryByTestId('app-shell')).toBeNull()
    expect(screen.queryByLabelText(msg('login.username'))).toBeNull()

    act(() => load.resolve({ ...DEFAULT_SETTINGS }))
    await waitFor(() => expect(screen.getByTestId('app-shell')).toBeTruthy())
  })

  it('applies persisted theme/glow attributes before the shell is visible (no flash)', async () => {
    const load = deferred<Settings>()
    stubSettingsLoad(load.promise)
    mockAuthStatuses(
      { platform: 'vrchat', state: 'authenticated', accountId: 'usr_neo', displayName: 'Neo' },
      cvrUnauthenticated
    )
    renderApp()

    await waitFor(() => expect(screen.queryByTestId('app-shell')).toBeNull())
    // Default pre-reveal look: dark canvas (no data-theme) + standard glow (no data-glow).
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    expect(document.documentElement.hasAttribute('data-glow')).toBe(false)

    // Async act: the store update rides the promise-resolution microtask — a
    // sync act would assert against pre-hydration DOM (driver fix).
    await act(async () => {
      load.resolve({ ...DEFAULT_SETTINGS, theme: 'light', backgroundGlow: 'muted' })
    })

    // The attributes must land before (in the same commit as) the shell reveal.
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(document.documentElement.getAttribute('data-glow')).toBe('muted')
    expect(screen.getByTestId('app-shell')).toBeTruthy()
  })

  it('renders the shell on the first tick when getSettings resolves immediately with defaults', async () => {
    stubSettingsLoad(Promise.resolve({ ...DEFAULT_SETTINGS }))
    mockAuthStatuses(
      { platform: 'vrchat', state: 'authenticated', accountId: 'usr_neo', displayName: 'Neo' },
      cvrUnauthenticated
    )
    renderApp()

    await waitFor(() => expect(screen.getByTestId('app-shell')).toBeTruthy())
    expect(useSettingsStore.getState().hydrated).toBe(true)
  })
})
