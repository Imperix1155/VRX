// @vitest-environment jsdom
/**
 * Auth-gate routing tests (VRX-173).
 *
 * Pins the two-platform gate: pending-with-no-known-session → blank; either
 * authenticated → AppShell; neither authenticated → LoginScreen, preserving the
 * direct method-aware VRChat 2FA reprompt when CVR is disconnected.
 * AppShell is stubbed because its full tree is covered by component tests.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AuthStatus, Platform } from '@shared/types'
import i18n from './i18n'
import App from './App'

const useAuthStatusMock = vi.hoisted(() => vi.fn())
vi.mock('./queries/auth', () => ({
  useAuthStatus: useAuthStatusMock,
  authStatusQueryKey: (platform: string = 'vrchat') => ['auth-status', platform]
}))
// useApplyTheme touches matchMedia (absent in jsdom) — not under test here.
vi.mock('./hooks/useApplyTheme', () => ({ useApplyTheme: vi.fn() }))
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
  displayName: null
}
const cvrUnauthenticated: AuthStatus = {
  platform: 'chilloutvr',
  state: 'unauthenticated',
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

afterEach(() => {
  cleanup()
  useAuthStatusMock.mockReset()
})

describe('App auth gate (VRX-173, platform parity)', () => {
  it('routes VRChat needs-2fa to LoginScreen when CVR is disconnected', () => {
    mockAuthStatuses(
      {
        platform: 'vrchat',
        state: 'needs-2fa',
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
      { platform: 'vrchat', state: 'needs-2fa', displayName: null },
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
      { platform: 'vrchat', state: 'authenticated', displayName: 'Neo' },
      cvrUnauthenticated
    )
    renderApp()

    expect(screen.getByTestId('app-shell')).toBeTruthy()
  })

  it('renders the shell when CVR alone remains authenticated after VRChat disconnects', () => {
    mockAuthStatuses(vrcUnauthenticated, {
      platform: 'chilloutvr',
      state: 'authenticated',
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
        displayName: null,
        twoFactorMethod: 'totp'
      },
      { platform: 'chilloutvr', state: 'authenticated', displayName: 'Trinity' }
    )
    renderApp()

    expect(screen.getByTestId('app-shell')).toBeTruthy()
    expect(screen.queryByText(msg('login.twoFactor.promptTotp'))).toBeNull()
  })

  it('renders nothing while either unresolved platform could still be authenticated', () => {
    mockAuthStatuses(vrcUnauthenticated, cvrUnauthenticated, ['chilloutvr'])
    renderApp()

    expect(screen.queryByLabelText(msg('login.username'))).toBeNull()
    expect(screen.queryByTestId('app-shell')).toBeNull()
  })
})
