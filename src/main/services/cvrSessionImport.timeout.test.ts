import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs/promises', () => ({
  lstat: vi.fn(() => new Promise<never>(() => undefined)),
  open: vi.fn(() => new Promise<never>(() => undefined)),
  opendir: vi.fn(() => new Promise<never>(() => undefined))
}))

import { importCvrSession } from './cvrSessionImport'

describe('CVR session import I/O deadline', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns null without blocking when every filesystem operation stalls', async () => {
    vi.useFakeTimers()

    const result = importCvrSession({
      appDataPath: '/app-data',
      homePath: '/home',
      platform: 'linux',
      environment: {}
    })
    const startedAt = Date.now()
    await vi.runAllTimersAsync()

    await expect(result).resolves.toBeNull()
    expect(Date.now() - startedAt).toBeLessThanOrEqual(1_000)
  })
})
