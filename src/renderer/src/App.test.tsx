// @vitest-environment jsdom
/**
 * Auth-gate routing tests (VRX-173).
 *
 * Pins the three-way gate: pending → blank; needs-2fa → LoginScreen opened
 * DIRECTLY on the method-aware code prompt (the reprompt path — no password
 * re-entry); unauthenticated → the credentials form.
 * AppShell (authenticated) is not rendered here — it pulls the full shell tree
 * and is covered by its own component tests.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import i18n from './i18n'
import App from './App'

const useAuthStatusMock = vi.hoisted(() => vi.fn())
vi.mock('./queries/auth', () => ({
  useAuthStatus: useAuthStatusMock,
  authStatusQueryKey: ['auth-status', 'vrchat']
}))
// useApplyTheme touches matchMedia (absent in jsdom) — not under test here.
vi.mock('./hooks/useApplyTheme', () => ({ useApplyTheme: vi.fn() }))
// AppShell drags in the whole shell tree — stub it; the gate is what's under test.
vi.mock('./components/AppShell', () => ({
  default: () => <div data-testid="app-shell" />
}))

const msg = (key: string): string => i18n.t(key)

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

describe('App auth gate (VRX-173)', () => {
  it('routes needs-2fa straight to the method-aware code prompt (no password form)', () => {
    useAuthStatusMock.mockReturnValue({
      data: {
        platform: 'vrchat',
        state: 'needs-2fa',
        displayName: null,
        twoFactorMethod: 'email'
      },
      isPending: false
    })
    renderApp()

    expect(screen.getByText(msg('login.twoFactor.promptEmail'))).toBeTruthy()
    expect(screen.queryByLabelText(msg('login.password'))).toBeNull()
  })

  it('falls back to totp copy when needs-2fa carries no method', () => {
    useAuthStatusMock.mockReturnValue({
      data: { platform: 'vrchat', state: 'needs-2fa', displayName: null },
      isPending: false
    })
    renderApp()

    expect(screen.getByText(msg('login.twoFactor.promptTotp'))).toBeTruthy()
  })

  it('shows the credentials form when unauthenticated', () => {
    useAuthStatusMock.mockReturnValue({
      data: { platform: 'vrchat', state: 'unauthenticated', displayName: null },
      isPending: false
    })
    renderApp()

    expect(screen.getByLabelText(msg('login.username'))).toBeTruthy()
  })

  it('renders the shell when authenticated', () => {
    useAuthStatusMock.mockReturnValue({
      data: { platform: 'vrchat', state: 'authenticated', displayName: 'Neo' },
      isPending: false
    })
    renderApp()

    expect(screen.getByTestId('app-shell')).toBeTruthy()
  })

  it('renders nothing while the auth check is pending (no login flash)', () => {
    useAuthStatusMock.mockReturnValue({ data: undefined, isPending: true })
    renderApp()

    expect(screen.queryByLabelText(msg('login.username'))).toBeNull()
    expect(screen.queryByTestId('app-shell')).toBeNull()
  })
})
