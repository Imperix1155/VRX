import { describe, expect, it, vi } from 'vitest'
import {
  IPC_RATE_LIMIT_BUDGETS,
  ipcRateLimitDenial,
  withRateLimit,
  type RateLimitBudget
} from './rate-limit'

const budget = (max: number, windowMs: number): RateLimitBudget => ({ max, windowMs })

describe('withRateLimit', () => {
  it('allows the exact budget and slides the window at the exact boundary', () => {
    let now = 0
    const handler = vi.fn(() => 'handled')
    const limited = withRateLimit('get-settings', budget(2, 100), handler, {
      clock: () => now,
      deny: () => 'denied'
    })

    expect(limited()).toBe('handled')
    now = 50
    expect(limited()).toBe('handled')
    now = 99
    expect(limited()).toBe('denied')
    now = 100
    expect(limited()).toBe('handled')
    expect(handler).toHaveBeenCalledTimes(3)
  })

  it('keeps independent state for each channel', () => {
    const getSettings = withRateLimit('get-settings', budget(1, 100), () => 'settings', {
      clock: () => 0,
      deny: () => 'denied'
    })
    const getAccounts = withRateLimit('get-accounts', budget(1, 100), () => 'accounts', {
      clock: () => 0,
      deny: () => 'denied'
    })

    expect(getSettings()).toBe('settings')
    expect(getSettings()).toBe('denied')
    expect(getAccounts()).toBe('accounts')
  })

  it('warns once while a denied window is active and warns again after it slides', () => {
    let now = 0
    const warn = vi.fn()
    const limited = withRateLimit('get-settings', budget(1, 100), () => 'handled', {
      clock: () => now,
      deny: () => 'denied',
      warn
    })

    expect(limited()).toBe('handled')
    expect(limited()).toBe('denied')
    expect(limited()).toBe('denied')
    expect(warn).toHaveBeenCalledTimes(1)

    now = 100
    expect(limited()).toBe('handled')
    expect(limited()).toBe('denied')
    expect(warn).toHaveBeenCalledTimes(2)
    expect(warn).toHaveBeenLastCalledWith('IPC rate limit exceeded', {
      channel: 'get-settings'
    })
  })

  it('fails open when the injected clock throws', () => {
    const handler = vi.fn(() => 'handled')
    const limited = withRateLimit('get-settings', budget(1, 100), handler, {
      clock: () => {
        throw new Error('clock failed')
      },
      deny: () => 'denied'
    })

    expect(limited()).toBe('handled')
    expect(limited()).toBe('handled')
  })

  it('contains logger failures without changing the denial result', () => {
    const limited = withRateLimit('get-settings', budget(1, 100), () => 'handled', {
      clock: () => 0,
      deny: () => 'denied',
      warn: () => {
        throw new Error('logger failed')
      }
    })

    expect(limited()).toBe('handled')
    expect(limited()).toBe('denied')
  })
})

describe('IPC denial shapes', () => {
  it('returns the structured InstanceActionResult denial for an action channel', () => {
    expect(ipcRateLimitDenial('join-instance')).toEqual({
      ok: false,
      reason: 'rate-limited'
    })
  })

  it('throws rate_limited for a query channel', () => {
    expect(() => ipcRateLimitDenial('get-friends')).toThrowError('rate_limited')
  })

  it('silently drops renderer-hydrated and logs only its first denial', () => {
    const handler = vi.fn(() => undefined)
    const warn = vi.fn()
    const limited = withRateLimit('renderer-hydrated', budget(1, 1_000), handler, {
      clock: () => 0,
      deny: () => undefined,
      warn
    })

    expect(limited()).toBeUndefined()
    expect(limited()).toBeUndefined()
    expect(limited()).toBeUndefined()
    expect(handler).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledTimes(1)
  })
})

describe('get-avatar budget', () => {
  it('allows three complete 200-friend roster repaints without a denial', () => {
    const handler = vi.fn(() => 'avatar')
    const warn = vi.fn()
    const limited = withRateLimit('get-avatar', IPC_RATE_LIMIT_BUDGETS['get-avatar'], handler, {
      clock: () => 0,
      deny: () => ipcRateLimitDenial('get-avatar'),
      warn
    })

    for (let request = 0; request < 600; request += 1) {
      expect(limited()).toBe('avatar')
    }

    expect(handler).toHaveBeenCalledTimes(600)
    expect(warn).not.toHaveBeenCalled()
  })
})
