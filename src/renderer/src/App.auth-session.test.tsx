// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/settings'
import {
  CREDENTIAL_PERSISTENCE_FAILED,
  type AuthStatus,
  type LoginResult,
  type Platform
} from '@shared/types'
import App from './App'
import i18n from './i18n'
import { authStatusQueryKey } from './queries/auth'
import { useSettingsStore } from './stores/settings'

vi.mock('./components/AppShell', () => ({
  default: () => <div data-testid="app-shell" />
}))

const msg = (key: string): string => i18n.t(key)

class ResizeObserverStub {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)

const needsTwoFactor: AuthStatus = {
  platform: 'vrchat',
  state: 'needs-2fa',
  accountId: null,
  displayName: null,
  twoFactorMethod: 'totp'
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

function renderAppWithResult(
  result: LoginResult,
  initialVrcStatus: AuthStatus = needsTwoFactor
): {
  queryClient: QueryClient
  login: ReturnType<typeof vi.fn>
  verify2fa: ReturnType<typeof vi.fn>
} {
  const login = vi.fn().mockResolvedValue(result)
  const verify2fa = vi.fn().mockResolvedValue(result)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(authStatusQueryKey('vrchat'), initialVrcStatus)
  queryClient.setQueryData(authStatusQueryKey('chilloutvr'), cvrUnauthenticated)
  const statuses: Record<Platform, AuthStatus> = {
    vrchat: initialVrcStatus,
    chilloutvr: cvrUnauthenticated
  }
  Object.assign(window, {
    vrx: {
      getSettings: vi.fn().mockResolvedValue({ ...DEFAULT_SETTINGS }),
      getAuthStatus: vi.fn(({ platform }: { platform: Platform }) =>
        Promise.resolve(statuses[platform])
      ),
      login,
      verify2fa
    }
  })
  render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  )
  return { queryClient, login, verify2fa }
}

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

describe('App terminal auth reconciliation', () => {
  it('keeps secure-store instructions visible when completed 2FA clears the session', async () => {
    const { queryClient, verify2fa } = renderAppWithResult({
      ok: false,
      needs2fa: false,
      error: CREDENTIAL_PERSISTENCE_FAILED,
      sessionCleared: true
    })

    fireEvent.change(await screen.findByLabelText(msg('login.twoFactor.code')), {
      target: { value: '654321' }
    })
    fireEvent.click(screen.getByRole('button', { name: msg('login.twoFactor.verify') }))

    expect(await screen.findByLabelText(msg('login.username'))).toBeTruthy()
    expect((await screen.findByRole('alert')).textContent).toContain(
      msg('login.error.credentialPersistence')
    )
    expect(verify2fa).toHaveBeenCalledWith({ platform: 'vrchat', code: '654321' })
    expect(queryClient.getQueryData<AuthStatus>(authStatusQueryKey('vrchat'))).toMatchObject({
      state: 'unauthenticated'
    })
  })

  it('keeps the generic error visible when a replacement login clears the session', async () => {
    const { queryClient, login } = renderAppWithResult({
      ok: false,
      needs2fa: false,
      error: 'unexpected_response',
      sessionCleared: true
    })

    await screen.findByLabelText(msg('login.twoFactor.code'))
    fireEvent.click(screen.getByRole('button', { name: msg('login.twoFactor.back') }))
    fireEvent.change(screen.getByLabelText(msg('login.username')), {
      target: { value: 'neo' }
    })
    fireEvent.change(screen.getByLabelText(msg('login.password')), {
      target: { value: 'redpill' }
    })
    fireEvent.click(screen.getByRole('button', { name: msg('login.signIn') }))

    expect((await screen.findByRole('alert')).textContent).toContain(msg('login.error.unknown'))
    expect(login).toHaveBeenCalledWith({
      platform: 'vrchat',
      credentials: { username: 'neo', password: 'redpill' }
    })
    expect(queryClient.getQueryData<AuthStatus>(authStatusQueryKey('vrchat'))).toMatchObject({
      state: 'unauthenticated'
    })
  })

  it('reacts to a restored-session 2FA transition and drops any typed password', async () => {
    const { queryClient } = renderAppWithResult(
      { ok: false, needs2fa: true, method: 'totp' },
      vrcUnauthenticated
    )

    const password = await screen.findByLabelText<HTMLInputElement>(msg('login.password'))
    fireEvent.change(password, { target: { value: 'redpill' } })
    queryClient.setQueryData(authStatusQueryKey('vrchat'), needsTwoFactor)

    await screen.findByLabelText(msg('login.twoFactor.code'))
    fireEvent.click(screen.getByRole('button', { name: msg('login.twoFactor.back') }))
    expect(screen.getByLabelText<HTMLInputElement>(msg('login.password')).value).toBe('')
  })
})
