import { describe, expect, it, vi } from 'vitest'
import type { Platform } from '@shared/types'
import { DO_NOT_DISTURB_MS } from '@shared/doNotDisturb'
import { DoNotDisturbGameWatch } from './doNotDisturbWatch'

const NOW = 1_700_000_000_000

describe('DoNotDisturbGameWatch', () => {
  it('does not end a mute for a game that was already running, and ends when one starts', async () => {
    const end = vi.fn()
    let releaseSecond: () => void = () => undefined
    const second = new Promise<void>((resolve) => {
      releaseSecond = resolve
    })
    let calls = 0
    const watch = new DoNotDisturbGameWatch({
      choice: () => '1h',
      until: () => NOW + DO_NOT_DISTURB_MS['1h'],
      endOnGameStart: () => true,
      now: () => NOW,
      runningPlatforms: async () => {
        calls += 1
        if (calls === 1) return new Set<Platform>(['vrchat'])
        await second
        return new Set<Platform>(['vrchat', 'chilloutvr'])
      },
      end,
      intervalMs: 1
    })

    watch.sync()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(calls).toBeGreaterThanOrEqual(2)
    expect(end).not.toHaveBeenCalled()

    releaseSecond()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(end).toHaveBeenCalledTimes(1)
    watch.stop()
  })

  it('treats a failed process check as unknown, so the same game does not look newly started', async () => {
    const end = vi.fn()
    const reads: Array<ReadonlySet<Platform> | null> = [
      new Set(['vrchat']),
      null,
      new Set(['vrchat'])
    ]
    let calls = 0
    const watch = new DoNotDisturbGameWatch({
      choice: () => 'until-off',
      until: () => null,
      endOnGameStart: () => true,
      now: () => NOW,
      runningPlatforms: () => {
        const read = reads[Math.min(calls, reads.length - 1)] ?? null
        calls += 1
        return Promise.resolve(read)
      },
      end,
      intervalMs: 1
    })
    watch.sync()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(calls).toBeGreaterThanOrEqual(3)
    expect(end).not.toHaveBeenCalled()
    watch.stop()
  })

  it('does not treat the first successful list after a failure as a game start', async () => {
    const end = vi.fn()
    const reads: Array<ReadonlySet<Platform> | null> = [null, new Set(['vrchat'])]
    let calls = 0
    const watch = new DoNotDisturbGameWatch({
      choice: () => 'until-off',
      until: () => null,
      endOnGameStart: () => true,
      now: () => NOW,
      runningPlatforms: () => {
        const read = reads[Math.min(calls, reads.length - 1)] ?? null
        calls += 1
        return Promise.resolve(read)
      },
      end,
      intervalMs: 1
    })
    watch.sync()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(calls).toBeGreaterThanOrEqual(2)
    expect(end).not.toHaveBeenCalled()
    watch.stop()
  })

  it('stays quiet when ending on game start is off', async () => {
    const end = vi.fn()
    const running = vi.fn(() => Promise.resolve(new Set<Platform>(['vrchat'])))
    const watch = new DoNotDisturbGameWatch({
      choice: () => 'until-off',
      until: () => null,
      endOnGameStart: () => false,
      now: () => NOW,
      runningPlatforms: running,
      end
    })
    watch.sync()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(running).not.toHaveBeenCalled()
    expect(end).not.toHaveBeenCalled()
  })
})
