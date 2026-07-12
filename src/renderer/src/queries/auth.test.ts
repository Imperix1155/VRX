// @vitest-environment jsdom
/**
 * Bridge-guard tests for the query fetchers (2026-07 audit W6). Both must fail
 * closed (throw, so TanStack records an error) when `window.vrx` is absent —
 * never silently resolve — and pass through the bridge result when present.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchAuthStatus } from './auth'
import { fetchFriends } from './friends'

type AnyBridge = Record<string, ReturnType<typeof vi.fn>>

function setBridge(bridge: AnyBridge | undefined): void {
  ;(window as unknown as { vrx?: AnyBridge }).vrx = bridge
}

afterEach(() => {
  setBridge(undefined)
})

describe('query bridge guards', () => {
  it('fetchAuthStatus throws bridge_unavailable without window.vrx', async () => {
    setBridge(undefined)
    await expect(fetchAuthStatus()).rejects.toThrow('bridge_unavailable')
  })

  it('fetchFriends throws bridge_unavailable without window.vrx', async () => {
    setBridge(undefined)
    await expect(fetchFriends('vrchat')).rejects.toThrow('bridge_unavailable')
  })

  it('fetchAuthStatus passes the platform through the bridge', async () => {
    const getAuthStatus = vi.fn().mockResolvedValue({
      platform: 'vrchat',
      state: 'authenticated',
      accountId: 'usr_n',
      displayName: 'N'
    })
    setBridge({ getAuthStatus })

    await expect(fetchAuthStatus()).resolves.toMatchObject({ state: 'authenticated' })
    expect(getAuthStatus).toHaveBeenCalledWith({ platform: 'vrchat' })
  })

  it('fetchAuthStatus accepts a platform param (VRX-37, mirrors fetchFriends)', async () => {
    const getAuthStatus = vi.fn().mockResolvedValue({
      platform: 'chilloutvr',
      state: 'unauthenticated',
      accountId: null,
      displayName: null
    })
    setBridge({ getAuthStatus })

    await expect(fetchAuthStatus('chilloutvr')).resolves.toMatchObject({
      state: 'unauthenticated'
    })
    expect(getAuthStatus).toHaveBeenCalledWith({ platform: 'chilloutvr' })
  })

  it('fetchFriends passes the platform through the bridge', async () => {
    const getFriends = vi.fn().mockResolvedValue([])
    setBridge({ getFriends })

    await expect(fetchFriends('chilloutvr')).resolves.toEqual([])
    expect(getFriends).toHaveBeenCalledWith({ platform: 'chilloutvr' })
  })
})
