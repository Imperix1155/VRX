// @vitest-environment jsdom
/**
 * LoginScreen flow tests (2026-07 audit W6).
 *
 * The auth entry point had zero tests. Pins the credentials → 2FA → verify flow,
 * error surfacing (including bridge failures), and the security invariant that
 * the PASSWORD IS DROPPED from component state the moment 2FA is requested
 * (the second leg authenticates via the session cookie, never the password).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CREDENTIAL_PERSISTENCE_FAILED, type AuthStatus } from '@shared/types'
import { authStatusQueryKey, useAuthStatus } from '../queries/auth'
import i18n from '../i18n'
import LoginScreen from './LoginScreen'

const msg = (key: string): string => i18n.t(key)

// jsdom has no ResizeObserver (the segmented control's bubble measures the track).
class ResizeObserverStub {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)

type VrxBridge = {
  login: ReturnType<typeof vi.fn>
  verify2fa: ReturnType<typeof vi.fn>
}

function setBridge(bridge: VrxBridge | undefined): void {
  ;(window as unknown as { vrx?: VrxBridge }).vrx = bridge
}

function renderLogin(initialTwoFactor: 'totp' | 'email' | null = null): {
  queryClient: QueryClient
} {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <LoginScreen initialTwoFactor={initialTwoFactor} />
    </QueryClientProvider>
  )
  return { queryClient }
}

function QueryDrivenLogin(): React.JSX.Element {
  const { data } = useAuthStatus('vrchat')
  return (
    <LoginScreen
      initialTwoFactor={data?.state === 'needs-2fa' ? (data.twoFactorMethod ?? 'totp') : null}
    />
  )
}

function fillCredentials(username = 'neo', password = 'redpill'): void {
  fireEvent.change(screen.getByLabelText(msg('login.username')), { target: { value: username } })
  fireEvent.change(screen.getByLabelText(msg('login.password')), { target: { value: password } })
}

function submit(): void {
  fireEvent.click(screen.getByRole('button', { name: msg('login.signIn') }))
}

afterEach(() => {
  cleanup()
  setBridge(undefined)
  vi.restoreAllMocks()
})

describe('LoginScreen (W6)', () => {
  it('disables submit until both fields are filled', () => {
    setBridge({ login: vi.fn(), verify2fa: vi.fn() })
    renderLogin()
    const button = screen.getByRole('button', { name: msg('login.signIn') })
    expect(button).toHaveProperty('disabled', true)
    fillCredentials()
    expect(button).toHaveProperty('disabled', false)
  })

  it('invalidates the auth query on successful login (gate re-checks)', async () => {
    const login = vi.fn().mockResolvedValue({ ok: true })
    setBridge({ login, verify2fa: vi.fn() })
    const { queryClient } = renderLogin()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    fillCredentials()
    submit()

    await waitFor(() => expect(invalidate).toHaveBeenCalled())
    expect(login).toHaveBeenCalledWith({
      platform: 'vrchat',
      credentials: { username: 'neo', password: 'redpill' }
    })
  })

  it('surfaces invalid credentials as a role=alert error', async () => {
    setBridge({
      login: vi
        .fn()
        .mockResolvedValue({ ok: false, needs2fa: false, error: 'invalid_credentials' }),
      verify2fa: vi.fn()
    })
    renderLogin()
    fillCredentials()
    submit()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(msg('login.error.unknown'))
  })

  it('surfaces a credential persistence failure without invalidating auth', async () => {
    setBridge({
      login: vi.fn().mockResolvedValue({
        ok: false,
        needs2fa: false,
        error: CREDENTIAL_PERSISTENCE_FAILED,
        sessionCleared: true
      }),
      verify2fa: vi.fn()
    })
    const { queryClient } = renderLogin()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    fillCredentials()
    submit()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(msg('login.error.credentialPersistence'))
    expect(screen.getByLabelText<HTMLInputElement>(msg('login.password')).value).toBe('')
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('switches to the 2FA prompt AND drops the password from state', async () => {
    setBridge({
      login: vi.fn().mockResolvedValue({ ok: false, needs2fa: true, method: 'totp' }),
      verify2fa: vi.fn()
    })
    renderLogin()
    fillCredentials()
    submit()

    // TOTP prompt shows (method-aware copy).
    await screen.findByText(msg('login.twoFactor.promptTotp'))

    // Go Back — the credentials form must come back with the password GONE
    // (dropped on the needs2fa transition, not merely hidden).
    fireEvent.click(screen.getByRole('button', { name: msg('login.twoFactor.back') }))
    const passwordInput = screen.getByLabelText<HTMLInputElement>(msg('login.password'))
    expect(passwordInput.value).toBe('')
    // Username is kept (not a secret; re-typing it would be pure friction).
    const usernameInput = screen.getByLabelText<HTMLInputElement>(msg('login.username'))
    expect(usernameInput.value).toBe('neo')
  })

  it('shows the email prompt for the email 2FA method', async () => {
    setBridge({
      login: vi.fn().mockResolvedValue({ ok: false, needs2fa: true, method: 'email' }),
      verify2fa: vi.fn()
    })
    renderLogin()
    fillCredentials()
    submit()
    await screen.findByText(msg('login.twoFactor.promptEmail'))
  })

  it('verifies the 2FA code via verify2fa (cookie leg — no credentials resent)', async () => {
    const verify2fa = vi.fn().mockResolvedValue({ ok: true })
    setBridge({
      login: vi.fn().mockResolvedValue({ ok: false, needs2fa: true, method: 'totp' }),
      verify2fa
    })
    const { queryClient } = renderLogin()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    fillCredentials()
    submit()
    await screen.findByText(msg('login.twoFactor.promptTotp'))

    fireEvent.change(screen.getByLabelText(msg('login.twoFactor.code')), {
      target: { value: '123456' }
    })
    fireEvent.click(screen.getByRole('button', { name: msg('login.twoFactor.verify') }))

    await waitFor(() => expect(invalidate).toHaveBeenCalled())
    expect(verify2fa).toHaveBeenCalledWith({ platform: 'vrchat', code: '123456' })
  })

  it('keeps the 2FA form up with an error on a rejected code', async () => {
    setBridge({
      login: vi.fn().mockResolvedValue({ ok: false, needs2fa: true, method: 'totp' }),
      verify2fa: vi
        .fn()
        .mockResolvedValue({ ok: false, needs2fa: false, error: 'invalid_2fa_code' })
    })
    renderLogin()
    fillCredentials()
    submit()
    await screen.findByText(msg('login.twoFactor.promptTotp'))

    fireEvent.change(screen.getByLabelText(msg('login.twoFactor.code')), {
      target: { value: '000000' }
    })
    fireEvent.click(screen.getByRole('button', { name: msg('login.twoFactor.verify') }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(msg('login.error.unknown'))
    // Still on the 2FA form — retryable.
    expect(screen.getByLabelText(msg('login.twoFactor.code'))).toBeTruthy()
  })

  it('returns completed 2FA persistence failures to credentials with the code cleared', async () => {
    const login = vi.fn().mockResolvedValue({ ok: false, needs2fa: true, method: 'totp' })
    setBridge({
      login,
      verify2fa: vi.fn().mockResolvedValue({
        ok: false,
        needs2fa: false,
        error: CREDENTIAL_PERSISTENCE_FAILED,
        sessionCleared: true
      })
    })
    const { queryClient } = renderLogin('totp')
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    fireEvent.change(screen.getByLabelText(msg('login.twoFactor.code')), {
      target: { value: '654321' }
    })
    fireEvent.click(screen.getByRole('button', { name: msg('login.twoFactor.verify') }))

    expect(await screen.findByLabelText(msg('login.username'))).toBeTruthy()
    expect(screen.queryByLabelText(msg('login.twoFactor.code'))).toBeNull()
    expect((await screen.findByRole('alert')).textContent).toContain(
      msg('login.error.credentialPersistence')
    )
    expect(invalidate).not.toHaveBeenCalled()

    fillCredentials()
    submit()
    const freshCode = await screen.findByLabelText<HTMLInputElement>(msg('login.twoFactor.code'))
    expect(freshCode.value).toBe('')
  })

  it('keeps persistence copy and cannot reseed 2FA after a terminal failure and tab remount', async () => {
    setBridge({
      login: vi.fn(),
      verify2fa: vi.fn().mockResolvedValue({
        ok: false,
        needs2fa: false,
        error: CREDENTIAL_PERSISTENCE_FAILED,
        sessionCleared: true
      })
    })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData<AuthStatus>(authStatusQueryKey('vrchat'), {
      platform: 'vrchat',
      state: 'needs-2fa',
      accountId: null,
      displayName: null,
      twoFactorMethod: 'totp'
    })
    render(
      <QueryClientProvider client={queryClient}>
        <QueryDrivenLogin />
      </QueryClientProvider>
    )
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    fireEvent.change(await screen.findByLabelText(msg('login.twoFactor.code')), {
      target: { value: '654321' }
    })
    fireEvent.click(screen.getByRole('button', { name: msg('login.twoFactor.verify') }))
    expect(await screen.findByLabelText(msg('login.username'))).toBeTruthy()
    expect((await screen.findByRole('alert')).textContent).toContain(
      msg('login.error.credentialPersistence')
    )
    expect(queryClient.getQueryData<AuthStatus>(authStatusQueryKey('vrchat'))).toMatchObject({
      state: 'unauthenticated'
    })
    expect(invalidate).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('radio', { name: msg('settings.accounts.chilloutvr.label') }))
    fireEvent.click(screen.getByRole('radio', { name: msg('settings.accounts.vrchat.label') }))
    expect(screen.getByLabelText(msg('login.username'))).toBeTruthy()
    expect(screen.queryByLabelText(msg('login.twoFactor.code'))).toBeNull()
  })

  it('cannot reseed 2FA after a replacement login reports that main cleared the session', async () => {
    setBridge({
      login: vi.fn().mockResolvedValue({
        ok: false,
        needs2fa: false,
        error: 'unexpected_response',
        sessionCleared: true
      }),
      verify2fa: vi.fn()
    })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData<AuthStatus>(authStatusQueryKey('vrchat'), {
      platform: 'vrchat',
      state: 'needs-2fa',
      accountId: null,
      displayName: null,
      twoFactorMethod: 'totp'
    })
    render(
      <QueryClientProvider client={queryClient}>
        <QueryDrivenLogin />
      </QueryClientProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: msg('login.twoFactor.back') }))
    fillCredentials()
    submit()

    expect((await screen.findByRole('alert')).textContent).toContain(msg('login.error.unknown'))
    expect(queryClient.getQueryData<AuthStatus>(authStatusQueryKey('vrchat'))).toMatchObject({
      state: 'unauthenticated'
    })

    fireEvent.click(screen.getByRole('radio', { name: msg('settings.accounts.chilloutvr.label') }))
    fireEvent.click(screen.getByRole('radio', { name: msg('settings.accounts.vrchat.label') }))
    expect(screen.getByLabelText(msg('login.username'))).toBeTruthy()
    expect(screen.queryByLabelText(msg('login.twoFactor.code'))).toBeNull()
  })

  it('surfaces a bridge/IPC failure instead of silently re-enabling', async () => {
    setBridge({
      login: vi.fn().mockRejectedValue(new Error('ipc handler threw')),
      verify2fa: vi.fn()
    })
    renderLogin()
    fillCredentials()
    submit()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(msg('login.error.unknown'))
    // Button re-enabled for retry.
    expect(screen.getByRole('button', { name: msg('login.signIn') })).toHaveProperty(
      'disabled',
      false
    )
  })

  it('opens directly on the 2FA prompt when seeded by the auth gate (VRX-173 reprompt)', () => {
    setBridge({ login: vi.fn(), verify2fa: vi.fn() })
    renderLogin('email')

    // Method-aware prompt, no credentials form, nothing asked twice.
    expect(screen.getByText(msg('login.twoFactor.promptEmail'))).toBeTruthy()
    expect(screen.queryByLabelText(msg('login.username'))).toBeNull()
    expect(screen.queryByLabelText(msg('login.password'))).toBeNull()
  })

  it('verifies a reprompt code via the session cookie (no login() call) and re-checks auth', async () => {
    const login = vi.fn()
    const verify2fa = vi.fn().mockResolvedValue({ ok: true })
    setBridge({ login, verify2fa })
    const { queryClient } = renderLogin('totp')
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    fireEvent.change(screen.getByLabelText(msg('login.twoFactor.code')), {
      target: { value: '654321' }
    })
    fireEvent.click(screen.getByRole('button', { name: msg('login.twoFactor.verify') }))

    await waitFor(() => expect(invalidate).toHaveBeenCalled())
    expect(verify2fa).toHaveBeenCalledWith({ platform: 'vrchat', code: '654321' })
    expect(login).not.toHaveBeenCalled() // the password never enters this flow
  })

  it('Back from a seeded reprompt falls back to the full credentials form (escape hatch)', () => {
    setBridge({ login: vi.fn(), verify2fa: vi.fn() })
    renderLogin('totp')

    fireEvent.click(screen.getByRole('button', { name: msg('login.twoFactor.back') }))

    expect(screen.getByLabelText(msg('login.username'))).toBeTruthy()
    expect(screen.getByLabelText(msg('login.password'))).toBeTruthy()
  })

  it('shows the generic error when the bridge is entirely absent', async () => {
    setBridge(undefined)
    renderLogin()
    fillCredentials()
    submit()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(msg('login.error.unknown'))
  })
})

describe('LoginScreen — platform tabs (VRX-217)', () => {
  function cvrTab(): HTMLElement {
    return screen.getByRole('radio', { name: msg('settings.accounts.chilloutvr.label') })
  }
  function vrcTab(): HTMLElement {
    return screen.getByRole('radio', { name: msg('settings.accounts.vrchat.label') })
  }

  it('renders the tabs as a radiogroup with VRChat preselected and roving tabindex', () => {
    setBridge({ login: vi.fn(), verify2fa: vi.fn() })
    renderLogin()

    expect(screen.getByRole('radiogroup', { name: msg('login.tabs.aria') })).toBeTruthy()
    expect(vrcTab().getAttribute('aria-checked')).toBe('true')
    expect(vrcTab().tabIndex).toBe(0)
    expect(cvrTab().getAttribute('aria-checked')).toBe('false')
    expect(cvrTab().tabIndex).toBe(-1)
    // Platform color rides on the WORD (§9.1) via the AA login-tab tokens —
    // never a filled color block.
    expect(vrcTab().style.color).toBe('var(--login-tab-vrc)')
    expect(cvrTab().style.color).toBe('var(--login-tab-cvr)')
  })

  it('switches to the ChilloutVR tab, rendering the email form', () => {
    setBridge({ login: vi.fn(), verify2fa: vi.fn() })
    renderLogin()

    // Password-manager autofill is partitioned per platform (VRX-217): the
    // VRChat form carries vrchat-scoped IDs + an MDN section-* autocomplete
    // group so a manager can't cross-fill into the CVR form.
    const vrcUsername = screen.getByLabelText(msg('login.username'))
    expect(vrcUsername.id).toBe('login-vrchat-username')
    expect(vrcUsername.getAttribute('autocomplete')).toBe('section-vrchat username')
    const vrcPassword = screen.getByLabelText(msg('login.password'))
    expect(vrcPassword.id).toBe('login-vrchat-password')
    expect(vrcPassword.getAttribute('autocomplete')).toBe('section-vrchat current-password')

    fireEvent.click(cvrTab())

    const cvrEmail = screen.getByLabelText(msg('login.email'))
    expect(cvrEmail).toBeTruthy()
    expect(cvrEmail.id).toBe('login-chilloutvr-username')
    expect(cvrEmail.getAttribute('autocomplete')).toBe('section-chilloutvr username')
    const cvrPassword = screen.getByLabelText(msg('login.password'))
    expect(cvrPassword.id).toBe('login-chilloutvr-password')
    expect(cvrPassword.getAttribute('autocomplete')).toBe('section-chilloutvr current-password')
    expect(screen.queryByLabelText(msg('login.username'))).toBeNull()
    expect(cvrTab().getAttribute('aria-checked')).toBe('true')
  })

  it('clears ALL typed state when switching tabs — a fresh form per platform', () => {
    setBridge({ login: vi.fn(), verify2fa: vi.fn() })
    renderLogin()

    fillCredentials()
    fireEvent.click(cvrTab())
    // Nothing carries across account systems — not even the username.
    expect(screen.getByLabelText<HTMLInputElement>(msg('login.email')).value).toBe('')
    expect(screen.getByLabelText<HTMLInputElement>(msg('login.password')).value).toBe('')

    fireEvent.click(vrcTab())
    expect(screen.getByLabelText<HTMLInputElement>(msg('login.username')).value).toBe('')
    expect(screen.getByLabelText<HTMLInputElement>(msg('login.password')).value).toBe('')
  })

  it('locks the platform tabs while a login is in flight — no orphaned flow, no concurrent logins', async () => {
    let release!: (result: { ok: boolean; needs2fa: boolean; error: string }) => void
    const held = new Promise<{ ok: boolean; needs2fa: boolean; error: string }>((resolve) => {
      release = resolve
    })
    setBridge({ login: vi.fn().mockReturnValue(held), verify2fa: vi.fn() })
    renderLogin()
    fillCredentials()
    submit()

    // Both radios lock with the aria-disabled affordance while the IPC is held…
    await waitFor(() => expect(cvrTab().getAttribute('aria-disabled')).toBe('true'))
    expect(vrcTab().getAttribute('aria-disabled')).toBe('true')
    // …and clicking the other platform does NOT switch — the in-flight flow
    // stays mounted so its late result can still surface here.
    fireEvent.click(cvrTab())
    expect(cvrTab().getAttribute('aria-checked')).toBe('false')
    expect(screen.getByLabelText(msg('login.username'))).toBeTruthy()

    // Settled: the late error lands in the LIVE form and the tabs re-enable.
    release({ ok: false, needs2fa: false, error: 'invalid_credentials' })
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(msg('login.error.unknown'))
    await waitFor(() => expect(cvrTab().getAttribute('aria-disabled')).toBeNull())
    fireEvent.click(cvrTab())
    expect(cvrTab().getAttribute('aria-checked')).toBe('true')
  })

  it('keeps a CVR terminal failure visible when restored VRChat 2FA arrives during submit', async () => {
    let release!: (result: {
      ok: false
      needs2fa: false
      error: typeof CREDENTIAL_PERSISTENCE_FAILED
      sessionCleared: true
    }) => void
    const held = new Promise<{
      ok: false
      needs2fa: false
      error: typeof CREDENTIAL_PERSISTENCE_FAILED
      sessionCleared: true
    }>((resolve) => {
      release = resolve
    })
    setBridge({ login: vi.fn().mockReturnValue(held), verify2fa: vi.fn() })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData<AuthStatus>(authStatusQueryKey('vrchat'), {
      platform: 'vrchat',
      state: 'unauthenticated',
      accountId: null,
      displayName: null
    })
    render(
      <QueryClientProvider client={queryClient}>
        <QueryDrivenLogin />
      </QueryClientProvider>
    )

    fireEvent.click(cvrTab())
    fireEvent.change(screen.getByLabelText(msg('login.email')), {
      target: { value: 'trinity@example.com' }
    })
    fireEvent.change(screen.getByLabelText(msg('login.password')), {
      target: { value: 'zion' }
    })
    submit()
    await waitFor(() => expect(vrcTab().getAttribute('aria-disabled')).toBe('true'))

    queryClient.setQueryData<AuthStatus>(authStatusQueryKey('vrchat'), {
      platform: 'vrchat',
      state: 'needs-2fa',
      accountId: null,
      displayName: null,
      twoFactorMethod: 'totp'
    })
    expect(cvrTab().getAttribute('aria-checked')).toBe('true')

    release({
      ok: false,
      needs2fa: false,
      error: CREDENTIAL_PERSISTENCE_FAILED,
      sessionCleared: true
    })

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(msg('login.error.credentialPersistence'))
    expect(cvrTab().getAttribute('aria-checked')).toBe('true')
    expect(screen.queryByLabelText(msg('login.twoFactor.code'))).toBeNull()
    expect(screen.getByLabelText<HTMLInputElement>(msg('login.password')).value).toBe('')

    // Re-selecting the active tab is a no-op: it must not release the deferred
    // VRChat prompt or hide the terminal recovery error.
    fireEvent.click(cvrTab())
    expect(cvrTab().getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('alert').textContent).toContain(
      msg('login.error.credentialPersistence')
    )
    expect(screen.queryByLabelText(msg('login.twoFactor.code'))).toBeNull()
  })

  it('applies a deferred VRChat 2FA prompt after a later non-terminal CVR retry', async () => {
    let releaseTerminal!: (result: {
      ok: false
      needs2fa: false
      error: typeof CREDENTIAL_PERSISTENCE_FAILED
      sessionCleared: true
    }) => void
    let releaseRetry!: (result: {
      ok: false
      needs2fa: false
      error: 'invalid_credentials'
    }) => void
    const terminal = new Promise<{
      ok: false
      needs2fa: false
      error: typeof CREDENTIAL_PERSISTENCE_FAILED
      sessionCleared: true
    }>((resolve) => {
      releaseTerminal = resolve
    })
    const retry = new Promise<{
      ok: false
      needs2fa: false
      error: 'invalid_credentials'
    }>((resolve) => {
      releaseRetry = resolve
    })
    const login = vi.fn().mockReturnValueOnce(terminal).mockReturnValueOnce(retry)
    setBridge({ login, verify2fa: vi.fn() })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData<AuthStatus>(authStatusQueryKey('vrchat'), {
      platform: 'vrchat',
      state: 'unauthenticated',
      accountId: null,
      displayName: null
    })
    render(
      <QueryClientProvider client={queryClient}>
        <QueryDrivenLogin />
      </QueryClientProvider>
    )

    fireEvent.click(cvrTab())
    fireEvent.change(screen.getByLabelText(msg('login.email')), {
      target: { value: 'trinity@example.com' }
    })
    fireEvent.change(screen.getByLabelText(msg('login.password')), {
      target: { value: 'zion' }
    })
    submit()
    await waitFor(() => expect(vrcTab().getAttribute('aria-disabled')).toBe('true'))

    queryClient.setQueryData<AuthStatus>(authStatusQueryKey('vrchat'), {
      platform: 'vrchat',
      state: 'needs-2fa',
      accountId: null,
      displayName: null,
      twoFactorMethod: 'totp'
    })
    releaseTerminal({
      ok: false,
      needs2fa: false,
      error: CREDENTIAL_PERSISTENCE_FAILED,
      sessionCleared: true
    })

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(msg('login.error.credentialPersistence'))
    expect(cvrTab().getAttribute('aria-checked')).toBe('true')

    fireEvent.change(screen.getByLabelText(msg('login.password')), {
      target: { value: 'new-zion' }
    })
    submit()
    await waitFor(() => expect(vrcTab().getAttribute('aria-disabled')).toBe('true'))
    releaseRetry({ ok: false, needs2fa: false, error: 'invalid_credentials' })

    await screen.findByLabelText(msg('login.twoFactor.code'))
    expect(vrcTab().getAttribute('aria-checked')).toBe('true')
    expect(login).toHaveBeenCalledTimes(2)
  })

  it('applies a restored VRChat 2FA prompt after a non-terminal CVR failure settles', async () => {
    let release!: (result: { ok: false; needs2fa: false; error: 'invalid_credentials' }) => void
    const held = new Promise<{
      ok: false
      needs2fa: false
      error: 'invalid_credentials'
    }>((resolve) => {
      release = resolve
    })
    setBridge({ login: vi.fn().mockReturnValue(held), verify2fa: vi.fn() })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData<AuthStatus>(authStatusQueryKey('vrchat'), {
      platform: 'vrchat',
      state: 'unauthenticated',
      accountId: null,
      displayName: null
    })
    render(
      <QueryClientProvider client={queryClient}>
        <QueryDrivenLogin />
      </QueryClientProvider>
    )

    fireEvent.click(cvrTab())
    fireEvent.change(screen.getByLabelText(msg('login.email')), {
      target: { value: 'trinity@example.com' }
    })
    fireEvent.change(screen.getByLabelText(msg('login.password')), {
      target: { value: 'zion' }
    })
    submit()
    await waitFor(() => expect(vrcTab().getAttribute('aria-disabled')).toBe('true'))

    queryClient.setQueryData<AuthStatus>(authStatusQueryKey('vrchat'), {
      platform: 'vrchat',
      state: 'needs-2fa',
      accountId: null,
      displayName: null,
      twoFactorMethod: 'totp'
    })
    release({ ok: false, needs2fa: false, error: 'invalid_credentials' })

    await screen.findByLabelText(msg('login.twoFactor.code'))
    expect(vrcTab().getAttribute('aria-checked')).toBe('true')
  })

  it('submits CVR credentials with platform chilloutvr', async () => {
    const login = vi.fn().mockResolvedValue({ ok: true })
    setBridge({ login, verify2fa: vi.fn() })
    const { queryClient } = renderLogin()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    fireEvent.click(cvrTab())
    fireEvent.change(screen.getByLabelText(msg('login.email')), {
      target: { value: 'trinity@example.com' }
    })
    fireEvent.change(screen.getByLabelText(msg('login.password')), {
      target: { value: 'zion' }
    })
    fireEvent.click(screen.getByRole('button', { name: msg('login.signIn') }))

    await waitFor(() => expect(invalidate).toHaveBeenCalled())
    expect(login).toHaveBeenCalledWith({
      platform: 'chilloutvr',
      credentials: { username: 'trinity@example.com', password: 'zion' }
    })
  })

  it('falls back to the generic error if needs2fa ever arrives for ChilloutVR — never a dead 2FA prompt', async () => {
    setBridge({
      login: vi.fn().mockResolvedValue({ ok: false, needs2fa: true, method: 'totp' }),
      verify2fa: vi.fn()
    })
    renderLogin()

    fireEvent.click(cvrTab())
    fireEvent.change(screen.getByLabelText(msg('login.email')), {
      target: { value: 'trinity@example.com' }
    })
    fireEvent.change(screen.getByLabelText(msg('login.password')), {
      target: { value: 'zion' }
    })
    fireEvent.click(screen.getByRole('button', { name: msg('login.signIn') }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(msg('login.error.unknown'))
    // CVR has no 2FA — an unusable code prompt must NOT render.
    expect(screen.queryByLabelText(msg('login.twoFactor.code'))).toBeNull()
  })

  it('keeps the seeded VRChat 2FA reprompt on the VRChat tab (VRX-173)', () => {
    setBridge({ login: vi.fn(), verify2fa: vi.fn() })
    renderLogin('totp')

    expect(vrcTab().getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText(msg('login.twoFactor.promptTotp'))).toBeTruthy()
  })
})
