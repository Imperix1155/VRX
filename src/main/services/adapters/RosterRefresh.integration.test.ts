import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdapterEvent, Platform } from '@shared/types'
import { CvrAdapter } from './CvrAdapter'
import { VrcAdapter } from './VrcAdapter'
import {
  instantAdmission,
  jsonResponse,
  markVrcSessionEstablished
} from './__testutils__/adapterTestKit'

function fixture(platform: Platform): { adapter: CvrAdapter | VrcAdapter; event(): void } {
  if (platform === 'chilloutvr') {
    const adapter = new CvrAdapter(
      {
        load: () => ({ username: 'fixture', accessKey: 'fixture' }),
        save: () => {},
        delete: () => {}
      },
      instantAdmission()
    )
    Object.assign(adapter, { validated: true })
    const drive = adapter as unknown as { handlePipelineEvent(event: AdapterEvent): void }
    return { adapter, event: () => drive.handlePipelineEvent({ type: 'roster-changed', platform }) }
  }
  const adapter = new VrcAdapter(
    { load: () => 'auth=fixture', save: () => {}, delete: () => {} },
    instantAdmission()
  )
  markVrcSessionEstablished(adapter)
  const pipeline = (
    adapter as unknown as { createPipeline(): { emit(event: AdapterEvent): void } }
  ).createPipeline()
  return { adapter, event: () => pipeline.emit({ type: 'connection', platform, health: 'live' }) }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe.each(['vrchat', 'chilloutvr'] as const)('%s roster event coalescing', (platform) => {
  it('bounds an event storm to one follow-up and publishes its result to every caller', async () => {
    let releaseFirst!: () => void
    let releaseLast!: () => void
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const last = new Promise<void>((resolve) => {
      releaseLast = resolve
    })
    let snapshots = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (platform === 'chilloutvr' || url.endsWith('/auth/user')) {
        snapshots++
        if (snapshots === 1) await first
        if (snapshots === 2) await last
      }
      const name = snapshots === 1 ? 'First' : 'Final'
      if (platform === 'chilloutvr')
        return jsonResponse({
          message: 'ok',
          data: [
            { id: 'a1b2c3d4-0000-0000-0000-000000000001', name, imageUrl: null, categories: [] }
          ]
        })
      if (url.endsWith('/auth/user')) return jsonResponse({ onlineFriends: [] })
      return jsonResponse(
        url.includes('offline=true') ? [] : [{ id: 'usr_fixture', displayName: name }]
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    const { adapter, event } = fixture(platform)
    const request = adapter.getFriends()
    await vi.waitFor(() => expect(snapshots).toBe(1))
    const callers = [request]
    for (let i = 0; i < 50; i++) {
      event()
      callers.push(adapter.getFriends())
    }
    releaseFirst()
    await vi.waitFor(() => expect(snapshots).toBe(2))
    for (let i = 0; i < 50; i++) {
      event()
      callers.push(adapter.getFriends())
    }
    releaseLast()
    const results = await Promise.all(callers)
    expect(results.every((result) => result === results[0])).toBe(true)
    expect(results[0]?.friends[0]?.displayName).toBe('Final')
    expect(fetchMock).toHaveBeenCalledTimes(platform === 'chilloutvr' ? 2 : 6)
    await adapter.getFriends()
    expect(snapshots).toBe(3)
  })

  it('drops pending follow-up when an active roster rate limits', async () => {
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const fetchMock = vi.fn(async () => {
      await held
      return new Response(null, { status: 429, headers: { 'Retry-After': '60' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { adapter, event } = fixture(platform)
    const request = adapter.getFriends().catch((error: unknown) => error)
    for (let i = 0; i < 50; i++) event()
    release()
    expect(await request).toBeInstanceOf(Error)
    expect(fetchMock).toHaveBeenCalledOnce()
    await expect(adapter.getFriends()).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
