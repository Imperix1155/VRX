// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthStatus, Friend, Platform } from '@shared/types'
import { friendsQueryKey } from '../queries/friends'
import { deserializePersistedQueryCache, QUERY_CACHE_STORAGE_KEY } from '../queries/cache'

import { fullFriend } from '../test-utils/friendFixture'
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

function renderCard(platform: Platform, bridge: TestBridge): QueryClient {
  setBridge(bridge)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <AccountCard platform={platform} />
    </QueryClientProvider>
  )
  return queryClient
}

function bridgeFor(status: AuthStatus): TestBridge {
  return {
    getAuthStatus: vi.fn().mockResolvedValue(status),
    login: vi.fn().mockResolvedValue({ ok: true }),
    verify2fa: vi.fn().mockResolvedValue({ ok: true }),
    logout: vi.fn().mockResolvedValue(undefined)
  }
}

function storedFriends(platform: Platform): Friend[] | undefined {
  const raw = window.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)
  if (raw === null) return undefined
  // Route through the REAL restore path — asserting raw bytes could pass on an
  // envelope an actual hydrate would reject (round-4 F-E).
  const restored = deserializePersistedQueryCache(raw)
  return restored.clientState.queries.find(
    (query) => query.queryKey[0] === 'friends' && query.queryKey[1] === platform
  )?.state?.data as Friend[] | undefined
}

afterEach(() => {
  cleanup()
  setBridge(undefined)
  window.localStorage.clear()
})

describe.each([
  ['vrchat', 'Neo'],
  ['chilloutvr', 'Trinity']
] as const)('AccountCard — %s parity', (platform, displayName) => {
  it('shows the connect form when disconnected and delegates credentials to that platform', async () => {
    const bridge = bridgeFor({
      platform,
      state: 'unauthenticated',
      accountId: null,
      displayName: null
    })
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

  it('drops the password before post-login query invalidations settle', async () => {
    const bridge = bridgeFor({
      platform,
      state: 'unauthenticated',
      accountId: null,
      displayName: null
    })
    const queryClient = renderCard(platform, bridge)
    let releaseInvalidations!: () => void
    const heldInvalidations = new Promise<void>((resolve) => {
      releaseInvalidations = resolve
    })
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockReturnValue(heldInvalidations)

    fireEvent.change(await screen.findByLabelText(msg('settings.accounts.username')), {
      target: { value: 'user@example.com' }
    })
    const password = screen.getByLabelText<HTMLInputElement>(msg('settings.accounts.password'))
    fireEvent.change(password, { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: msg('settings.accounts.connect') }))

    await waitFor(() => expect(invalidate).toHaveBeenCalled())
    // The refresh is still held open: this only passes when the password is
    // cleared immediately after the login IPC, before refreshPlatformState().
    expect(password.value).toBe('')
    releaseInvalidations()
  })

  it('shows a neutral connected check, connected name, and a working Disconnect', async () => {
    let state: AuthStatus = {
      platform,
      state: 'authenticated',
      accountId: `${platform}-account`,
      displayName
    }
    const bridge = bridgeFor(state)
    bridge.getAuthStatus.mockImplementation(() => Promise.resolve(state))
    bridge.logout.mockImplementation(() => {
      state = { platform, state: 'unauthenticated', accountId: null, displayName: null }
      return Promise.resolve()
    })
    const queryClient = renderCard(platform, bridge)

    const connected = await screen.findByText(
      msg('settings.accounts.connectedAs', { name: displayName })
    )
    expect(connected.parentElement?.textContent).toContain('✓')
    expect(connected.parentElement?.className).toContain('text-[var(--text)]')
    expect(connected.parentElement?.className).not.toContain('--st-online-text')
    const disconnect = screen.getByRole('button', { name: msg('settings.accounts.disconnect') })
    expect(disconnect).toHaveProperty('disabled', false)
    // Cached social data for this platform must be emptied on logout (a later
    // login may be a different account) without removing the mounted query.
    queryClient.setQueryData(friendsQueryKey(platform), [{ displayName: 'Stale Friend' }])
    fireEvent.click(disconnect)

    await waitFor(() => expect(bridge.logout).toHaveBeenCalledWith({ platform }))
    expect(await screen.findByLabelText(msg('settings.accounts.username'))).toBeTruthy()
    expect(queryClient.getQueryData(friendsQueryKey(platform))).toEqual([])
    // The settled [] observer must not wake a doomed unauthenticated refetch.
    expect(queryClient.isFetching({ queryKey: friendsQueryKey(platform) })).toBe(0)
  })

  it('persists the cleared roster synchronously on logout and leaves the other platform untouched', async () => {
    const other = platform === 'vrchat' ? 'chilloutvr' : 'vrchat'
    let state: AuthStatus = {
      platform,
      state: 'authenticated',
      accountId: `${platform}-account`,
      displayName
    }
    const bridge = bridgeFor(state)
    bridge.getAuthStatus.mockImplementation(() => Promise.resolve(state))
    bridge.logout.mockImplementation(() => {
      state = { platform, state: 'unauthenticated', accountId: null, displayName: null }
      return Promise.resolve()
    })
    const queryClient = renderCard(platform, bridge)

    await screen.findByText(msg('settings.accounts.connectedAs', { name: displayName }))
    const staleFriend = fullFriend('Stale Friend', platform)
    const otherFriend = fullFriend('Other Friend', other)
    queryClient.setQueryData(friendsQueryKey(platform), [staleFriend])
    queryClient.setQueryData(friendsQueryKey(other), [otherFriend])
    fireEvent.click(screen.getByRole('button', { name: msg('settings.accounts.disconnect') }))

    await waitFor(() => expect(bridge.logout).toHaveBeenCalledWith({ platform }))
    expect(queryClient.getQueryData(friendsQueryKey(platform))).toEqual([])
    expect(queryClient.getQueryData(friendsQueryKey(other))).toEqual([otherFriend])
    // The synchronous persist must land immediately, not wait for a later
    // throttled cache event that may never come before quit — asserted through
    // the real restore path with schema-complete friends.
    expect(storedFriends(platform)).toEqual([])
    expect(storedFriends(other)?.map((f) => f.displayName)).toEqual(['Other Friend'])
  })

  it('shows the unreachable banner with Retry and Sign out — never the Connect form — on error (VRX-201)', async () => {
    const bridge = bridgeFor({
      platform,
      state: 'error',
      accountId: null,
      displayName: null
    })
    renderCard(platform, bridge)

    const platformName = msg(`settings.accounts.${platform}.label`)
    expect(
      await screen.findByText(msg('settings.accounts.unreachable', { platform: platformName }))
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: msg('settings.accounts.retry') })).toBeTruthy()
    expect(screen.getByRole('button', { name: msg('settings.accounts.signOut') })).toBeTruthy()
    // The session may be alive — a Connect form here would invite a duplicate
    // login. It must NOT render.
    expect(screen.queryByLabelText(msg('settings.accounts.username'))).toBeNull()
    expect(screen.queryByLabelText(msg('settings.accounts.password'))).toBeNull()
  })

  it('Retry refetches auth status and converges the card when the platform recovers', async () => {
    let state: AuthStatus = { platform, state: 'error', accountId: null, displayName: null }
    const bridge = bridgeFor(state)
    bridge.getAuthStatus.mockImplementation(() => Promise.resolve(state))
    renderCard(platform, bridge)

    await screen.findByRole('button', { name: msg('settings.accounts.retry') })
    state = { platform, state: 'authenticated', accountId: `${platform}-account`, displayName }
    fireEvent.click(screen.getByRole('button', { name: msg('settings.accounts.retry') }))

    expect(
      await screen.findByText(msg('settings.accounts.connectedAs', { name: displayName }))
    ).toBeTruthy()
    expect(bridge.getAuthStatus.mock.calls.length).toBeGreaterThanOrEqual(2)
    // Retry only re-checks status — it must never touch credentials.
    expect(bridge.login).not.toHaveBeenCalled()
    expect(bridge.logout).not.toHaveBeenCalled()
  })

  it('Sign out from the unreachable banner runs the existing logout action', async () => {
    let state: AuthStatus = { platform, state: 'error', accountId: null, displayName: null }
    const bridge = bridgeFor(state)
    bridge.getAuthStatus.mockImplementation(() => Promise.resolve(state))
    bridge.logout.mockImplementation(() => {
      state = { platform, state: 'unauthenticated', accountId: null, displayName: null }
      return Promise.resolve()
    })
    renderCard(platform, bridge)

    fireEvent.click(await screen.findByRole('button', { name: msg('settings.accounts.signOut') }))

    await waitFor(() => expect(bridge.logout).toHaveBeenCalledWith({ platform }))
    // Once signed out, the card settles to the normal Connect form.
    expect(await screen.findByLabelText(msg('settings.accounts.username'))).toBeTruthy()
  })

  it('surfaces a durable-logout failure and keeps the connected card visible', async () => {
    const bridge = bridgeFor({
      platform,
      state: 'authenticated',
      accountId: `${platform}-account`,
      displayName
    })
    bridge.logout.mockRejectedValue(new Error('credential deletion failed'))
    renderCard(platform, bridge)

    fireEvent.click(
      await screen.findByRole('button', { name: msg('settings.accounts.disconnect') })
    )

    expect((await screen.findByRole('alert')).textContent).toContain(
      msg('settings.accounts.error.disconnect')
    )
    expect(
      screen.getByText(msg('settings.accounts.connectedAs', { name: displayName }))
    ).toBeTruthy()
  })
})

describe('AccountCard — VRChat two-factor flow', () => {
  it('uses the existing verify-2fa second leg without resending the password', async () => {
    const bridge = bridgeFor({
      platform: 'vrchat',
      state: 'unauthenticated',
      accountId: null,
      displayName: null
    })
    // First login IPC is HELD so the in-flight state is observable.
    let releaseLogin!: (result: { ok: boolean; needs2fa: boolean; method: 'totp' }) => void
    bridge.login.mockReturnValueOnce(
      new Promise((resolve) => {
        releaseLogin = resolve
      })
    )
    bridge.login.mockResolvedValue({ ok: false, needs2fa: true, method: 'totp' })
    renderCard('vrchat', bridge)

    fireEvent.change(await screen.findByLabelText(msg('settings.accounts.username')), {
      target: { value: 'neo' }
    })
    const password = screen.getByLabelText<HTMLInputElement>(msg('settings.accounts.password'))
    fireEvent.change(password, { target: { value: 'redpill' } })
    fireEvent.click(screen.getByRole('button', { name: msg('settings.accounts.connect') }))

    // While the login IPC is in flight, the live field still holds the secret.
    expect(password.value).toBe('redpill')
    releaseLogin({ ok: false, needs2fa: true, method: 'totp' })

    await screen.findByLabelText(msg('settings.accounts.twoFactor.code'))
    // The password was dropped from state on the needs2fa transition. Pin it
    // via the REMOUNTED field (mirrors the LoginScreen pin): press Back and
    // the credentials form returns with the password EMPTY, username kept.
    // (The old stale-node `password.value` check cannot observe this: React
    // batches the password clear and the 2FA transition into ONE render, so
    // the detached node never re-renders the cleared value.)
    fireEvent.click(screen.getByRole('button', { name: msg('settings.accounts.twoFactor.back') }))
    const remounted = screen.getByLabelText<HTMLInputElement>(msg('settings.accounts.password'))
    expect(remounted).not.toBe(password)
    expect(remounted.value).toBe('')
    expect(screen.getByLabelText<HTMLInputElement>(msg('settings.accounts.username')).value).toBe(
      'neo'
    )

    // Re-submit and complete the second leg: the code verifies via the session
    // cookie — the password is never resent.
    fireEvent.change(remounted, { target: { value: 'zion' } })
    fireEvent.click(screen.getByRole('button', { name: msg('settings.accounts.connect') }))
    const code = await screen.findByLabelText(msg('settings.accounts.twoFactor.code'))
    fireEvent.change(code, { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: msg('settings.accounts.twoFactor.verify') }))

    await waitFor(() =>
      expect(bridge.verify2fa).toHaveBeenCalledWith({ platform: 'vrchat', code: '123456' })
    )
    expect(bridge.login).toHaveBeenCalledTimes(2)
  })
})
