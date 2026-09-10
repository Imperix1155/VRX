import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiAdmissionController, MAX_ADMISSION_SLEEP_MS } from './ApiAdmissionController'
import { VrcPipeline } from './vrchat/VrcPipeline'
import { CvrPipeline } from './cvr/CvrPipeline'

class Socket extends EventEmitter {
  close = vi.fn(() => {
    this.emit('close')
  })
}

function rig(platform: 'vrchat' | 'chilloutvr'): {
  pipeline: VrcPipeline | CvrPipeline
  sockets: Socket[]
  admission: ApiAdmissionController
  provider: ReturnType<typeof vi.fn>
  rateLimited: ReturnType<typeof vi.fn>
  log: ReturnType<typeof vi.fn>
  onEvent: ReturnType<typeof vi.fn>
} {
  const admission = new ApiAdmissionController()
  const sockets: Socket[] = []
  const onEvent = vi.fn()
  const log = vi.fn()
  const provider = vi
    .fn()
    .mockImplementation(() => Promise.resolve(platform === 'vrchat' ? 'fixture' : {}))
  const rateLimited = vi.fn((retryAfter: string | null) => admission.rateLimited(retryAfter))
  const shared = {
    onEvent,
    log,
    onUpgradeRateLimited: rateLimited,
    cooldownUntil: () => admission.cooldownUntil,
    socketFactory: () => {
      const socket = new Socket()
      sockets.push(socket)
      return socket
    }
  }
  const pipeline =
    platform === 'vrchat'
      ? new VrcPipeline({ ...shared, tokenProvider: provider })
      : new CvrPipeline({ ...shared, headersProvider: provider })
  return { pipeline, sockets, admission, provider, rateLimited, log, onEvent }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(Date.UTC(2026, 8, 9))
  vi.spyOn(Math, 'random').mockReturnValue(0)
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe.each(['vrchat', 'chilloutvr'] as const)('%s reconnect admission', (platform) => {
  it('escalates repeated headerless rejections and shares the cooldown with REST admission', async () => {
    const r = rig(platform)
    r.pipeline.start()
    await vi.advanceTimersByTimeAsync(0)
    for (const delay of [1_000, 2_000, 4_000]) {
      const count = r.sockets.length
      r.sockets.at(-1)!.emit('upgrade-rejected', { statusCode: 429, retryAfter: null })
      await expect(r.admission.acquire({ rejectOnCooldown: true })).rejects.toThrow()
      await vi.advanceTimersByTimeAsync(delay - 1)
      expect(r.sockets).toHaveLength(count)
      await vi.advanceTimersByTimeAsync(1)
      expect(r.sockets).toHaveLength(count + 1)
    }
    r.pipeline.stop()
  })

  it('observes cooldown extensions while preparing credentials and isolates a restarted loop', async () => {
    const r = rig(platform)
    let release!: (value: string | Record<string, string>) => void
    r.provider.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve
      })
    )
    r.pipeline.start()
    await vi.advanceTimersByTimeAsync(0)
    r.admission.deferUntil(Date.now() + 60_000)
    release(platform === 'vrchat' ? 'fixture' : {})
    await vi.advanceTimersByTimeAsync(30_000)
    expect(r.sockets).toHaveLength(0)
    r.admission.deferUntil(Date.now() + 60_000)
    r.pipeline.stop()
    r.pipeline.start()
    await vi.advanceTimersByTimeAsync(59_999)
    expect(r.provider).toHaveBeenCalledOnce()
    expect(r.sockets).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(r.provider).toHaveBeenCalledTimes(2)
    expect(r.sockets).toHaveLength(1)
    r.pipeline.stop()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('escalates brief open-close flaps, caps them, and resets only after a sustained open', async () => {
    const r = rig(platform)
    r.pipeline.start()
    await vi.advanceTimersByTimeAsync(0)
    for (const delay of [1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000]) {
      const count = r.sockets.length
      r.sockets.at(-1)!.emit('open')
      r.sockets.at(-1)!.emit('close')
      await vi.advanceTimersByTimeAsync(delay - 1)
      expect(r.sockets).toHaveLength(count)
      await vi.advanceTimersByTimeAsync(1)
      expect(r.sockets).toHaveLength(count + 1)
    }
    r.sockets.at(-1)!.emit('open')
    await vi.advanceTimersByTimeAsync(60_000)
    const count = r.sockets.length
    r.sockets.at(-1)!.emit('close')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(r.sockets).toHaveLength(count + 1)
    r.pipeline.stop()
  })

  it.each([
    ['60', 60_000],
    ['Wed, 09 Sep 2026 00:01:30 GMT', 90_000],
    [null, 1_000],
    ['invalid', 1_000]
  ] as const)(
    'honors rejected-upgrade wait %s before preparing or dialing again',
    async (retryAfter, delay) => {
      const r = rig(platform)
      r.pipeline.start()
      await vi.advanceTimersByTimeAsync(0)
      const socket = r.sockets[0]!
      socket.emit('upgrade-rejected', { statusCode: 429, retryAfter })
      socket.emit('error', new Error('fixture-secret-not-for-logs'))
      socket.emit('close')
      socket.emit('upgrade-rejected', { statusCode: 429, retryAfter })
      await vi.advanceTimersByTimeAsync(delay - 1)
      expect(r.sockets).toHaveLength(1)
      expect(r.provider).toHaveBeenCalledOnce()
      expect(r.rateLimited).toHaveBeenCalledOnce()
      expect(r.admission.cooldownUntil).toBeGreaterThanOrEqual(Date.now())
      await vi.advanceTimersByTimeAsync(1)
      expect(r.sockets).toHaveLength(2)
      expect(JSON.stringify(r.log.mock.calls)).not.toContain('fixture-secret')
      r.pipeline.stop()
    }
  )

  it('rechecks extended and very long cooldowns, and cancels their wait on stop', async () => {
    const r = rig(platform)
    r.pipeline.start()
    await vi.advanceTimersByTimeAsync(0)
    r.sockets[0]!.emit('upgrade-rejected', { statusCode: 429, retryAfter: '3000000' })
    r.sockets[0]!.emit('close')
    await vi.advanceTimersByTimeAsync(MAX_ADMISSION_SLEEP_MS)
    expect(r.sockets).toHaveLength(1)
    r.admission.deferUntil(Date.now() + MAX_ADMISSION_SLEEP_MS * 2)
    await vi.advanceTimersByTimeAsync(MAX_ADMISSION_SLEEP_MS)
    expect(r.sockets).toHaveLength(1)
    r.pipeline.stop()
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(MAX_ADMISSION_SLEEP_MS * 2)
    expect(r.sockets).toHaveLength(1)
  })
})
