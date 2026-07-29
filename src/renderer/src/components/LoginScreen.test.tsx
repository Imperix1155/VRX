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
    // Platform color rides on the WORD (§9.1) — never a filled color block.
    expect(vrcTab().style.color).toBe('var(--vrc)')
    expect(cvrTab().style.color).toBe('var(--cvr)')
  })

  it('switches to the ChilloutVR tab, rendering the email form', () => {
    setBridge({ login: vi.fn(), verify2fa: vi.fn() })
    renderLogin()

    fireEvent.click(cvrTab())

    expect(screen.getByLabelText(msg('login.email'))).toBeTruthy()
    expect(screen.getByLabelText(msg('login.password'))).toBeTruthy()
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
