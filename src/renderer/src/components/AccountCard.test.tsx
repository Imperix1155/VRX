// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthStatus, Platform } from '@shared/types'
import i18n from '../i18n'
import AccountCard from './AccountCard'

type TestBridge = {
  getAuthStatus: ReturnType<typeof vi.fn>
  login: ReturnType<typeof vi.fn>
  verify2fa: ReturnType<typeof vi.fn>
  logout: ReturnType<typeof vi.fn>
}

const msg = (key: string, options?: Record<string, string>): string => i18n.t(key, options)

function setBridge(bridge: TestBridge | undefined): void {
  ;(window as unknown as { vrx?: TestBridge }).vrx = bridge
}

function renderCard(platform: Platform, bridge: TestBridge): void {
  setBridge(bridge)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <AccountCard platform={platform} />
    </QueryClientProvider>
  )
}

function bridgeFor(status: AuthStatus): TestBridge {
  return {
    getAuthStatus: vi.fn().mockResolvedValue(status),
    login: vi.fn().mockResolvedValue({ ok: true }),
    verify2fa: vi.fn().mockResolvedValue({ ok: true }),
    logout: vi.fn().mockResolvedValue(undefined)
  }
}

afterEach(() => {
  cleanup()
  setBridge(undefined)
})

describe.each([
  ['vrchat', 'Neo'],
  ['chilloutvr', 'Trinity']
] as const)('AccountCard — %s parity', (platform, displayName) => {
  it('shows the connect form when disconnected and delegates credentials to that platform', async () => {
    const bridge = bridgeFor({ platform, state: 'unauthenticated', displayName: null })
    renderCard(platform, bridge)

    const username = await screen.findByLabelText(msg('settings.accounts.username'))
    const password = screen.getByLabelText(msg('settings.accounts.password'))
    fireEvent.change(username, { target: { value: 'user@example.com' } })
    fireEvent.change(password, { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: msg('settings.accounts.connect') }))

    await waitFor(() =>
      expect(bridge.login).toHaveBeenCalledWith({
        platform,
        credentials: { username: 'user@example.com', password: 'secret' }
      })
    )
    expect((password as HTMLInputElement).value).toBe('')
  })

  it('shows the green check, connected name, and a working Disconnect', async () => {
    let state: AuthStatus = { platform, state: 'authenticated', displayName }
    const bridge = bridgeFor(state)
    bridge.getAuthStatus.mockImplementation(() => Promise.resolve(state))
    bridge.logout.mockImplementation(() => {
      state = { platform, state: 'unauthenticated', displayName: null }
      return Promise.resolve()
    })
    renderCard(platform, bridge)

    const connected = await screen.findByText(
      msg('settings.accounts.connectedAs', { name: displayName })
    )
    expect(connected.parentElement?.textContent).toContain('✓')
    const disconnect = screen.getByRole('button', { name: msg('settings.accounts.disconnect') })
    expect(disconnect).toHaveProperty('disabled', false)
    fireEvent.click(disconnect)

    await waitFor(() => expect(bridge.logout).toHaveBeenCalledWith({ platform }))
    expect(await screen.findByLabelText(msg('settings.accounts.username'))).toBeTruthy()
  })
})

describe('AccountCard — VRChat two-factor flow', () => {
  it('uses the existing verify-2fa second leg without resending the password', async () => {
    const bridge = bridgeFor({ platform: 'vrchat', state: 'unauthenticated', displayName: null })
    bridge.login.mockResolvedValue({ ok: false, needs2fa: true, method: 'totp' })
    renderCard('vrchat', bridge)

    fireEvent.change(await screen.findByLabelText(msg('settings.accounts.username')), {
      target: { value: 'neo' }
    })
    const password = screen.getByLabelText<HTMLInputElement>(msg('settings.accounts.password'))
    fireEvent.change(password, { target: { value: 'redpill' } })
    fireEvent.click(screen.getByRole('button', { name: msg('settings.accounts.connect') }))

    const code = await screen.findByLabelText(msg('settings.accounts.twoFactor.code'))
    expect(password.value).toBe('')
    fireEvent.change(code, { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: msg('settings.accounts.twoFactor.verify') }))

    await waitFor(() =>
      expect(bridge.verify2fa).toHaveBeenCalledWith({ platform: 'vrchat', code: '123456' })
    )
    expect(bridge.login).toHaveBeenCalledTimes(1)
  })
})
