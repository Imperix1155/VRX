/**
 * Quick launch (owner, 2026-11-18): starting a game without joining anyone.
 * The link is Steam's own and fixed per platform, an open game is left alone,
 * and a second press right after a start opens nothing more.
 */
import { describe, expect, it, vi, type Mock } from 'vitest'
import type { Platform } from '@shared/types'
import { isAllowedGameStartUrl } from '../ipc/url-allowlist'
import { GAME_START_REPEAT_MS, GameLauncher, buildGameStartUrl } from './gameLauncher'
import { JoinCoordinator } from './joinCoordinator'

interface Rig {
  launcher: GameLauncher
  openExternal: Mock<(url: string) => Promise<void>>
  joins: JoinCoordinator
  running: Set<Platform>
  advance: (ms: number) => void
}

function setup(overrides: { running?: Platform[]; canOpen?: (url: string) => boolean } = {}): Rig {
  let now = 0
  const running = new Set<Platform>(overrides.running ?? [])
  const openExternal = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined)
  const joins = new JoinCoordinator(() => now)
  const launcher = new GameLauncher({
    isRunning: (platform) => Promise.resolve(running.has(platform)),
    openExternal,
    joins,
    canOpen: overrides.canOpen,
    clock: () => now
  })
  return {
    launcher,
    openExternal,
    joins,
    running,
    advance: (ms: number): void => {
      now += ms
    }
  }
}

describe('buildGameStartUrl', () => {
  it("builds each platform's own Steam link, and both pass the allowlist", () => {
    expect(buildGameStartUrl('vrchat')).toBe('steam://rungameid/438100')
    expect(buildGameStartUrl('chilloutvr')).toBe('steam://rungameid/661130')
    expect(isAllowedGameStartUrl(buildGameStartUrl('vrchat'))).toBe(true)
    expect(isAllowedGameStartUrl(buildGameStartUrl('chilloutvr'))).toBe(true)
  })
})

describe('GameLauncher', () => {
  it.each<Platform>(['vrchat', 'chilloutvr'])(
    'starts %s through its Steam link',
    async (platform) => {
      const { launcher, openExternal } = setup()
      await expect(launcher.start(platform)).resolves.toEqual({ ok: true, state: 'started' })
      expect(openExternal).toHaveBeenCalledExactlyOnceWith(buildGameStartUrl(platform))
    }
  )

  it('leaves a game that is already open alone', async () => {
    const { launcher, openExternal } = setup({ running: ['vrchat'] })
    await expect(launcher.start('vrchat')).resolves.toEqual({ ok: true, state: 'already-open' })
    expect(openExternal).not.toHaveBeenCalled()
    // The other platform is not running, so it still starts.
    await expect(launcher.start('chilloutvr')).resolves.toEqual({ ok: true, state: 'started' })
    expect(openExternal).toHaveBeenCalledExactlyOnceWith(buildGameStartUrl('chilloutvr'))
  })

  it('opens nothing more for a second press while the game is still starting', async () => {
    const { launcher, openExternal, advance } = setup()
    await launcher.start('vrchat')
    advance(GAME_START_REPEAT_MS - 1)
    await expect(launcher.start('vrchat')).resolves.toEqual({ ok: true, state: 'starting' })
    expect(openExternal).toHaveBeenCalledOnce()
    // The other platform has its own window.
    await expect(launcher.start('chilloutvr')).resolves.toEqual({ ok: true, state: 'started' })
    advance(1)
    await expect(launcher.start('vrchat')).resolves.toEqual({ ok: true, state: 'started' })
    expect(openExternal).toHaveBeenCalledTimes(3)
  })

  it('starts again at once after the game was seen open and then closed', async () => {
    const { launcher, openExternal, running, advance } = setup()
    await launcher.start('vrchat')
    running.add('vrchat')
    advance(5_000)
    await expect(launcher.start('vrchat')).resolves.toEqual({ ok: true, state: 'already-open' })
    running.delete('vrchat')
    advance(5_000)
    await expect(launcher.start('vrchat')).resolves.toEqual({ ok: true, state: 'started' })
    expect(openExternal).toHaveBeenCalledTimes(2)
  })

  it('reports a failed open, and lets the next press try again', async () => {
    const { launcher, openExternal } = setup()
    openExternal.mockRejectedValueOnce(new Error('no handler'))
    await expect(launcher.start('vrchat')).resolves.toEqual({ ok: false, reason: 'launch-failed' })
    await expect(launcher.start('vrchat')).resolves.toEqual({ ok: true, state: 'started' })
    expect(openExternal).toHaveBeenCalledTimes(2)
  })

  it('opens nothing when this computer has nothing for the link', async () => {
    const canOpen = vi.fn(() => false)
    const { launcher, openExternal } = setup({ canOpen })
    await expect(launcher.start('chilloutvr')).resolves.toEqual({
      ok: false,
      reason: 'launch-failed'
    })
    expect(canOpen).toHaveBeenCalledWith(buildGameStartUrl('chilloutvr'))
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('treats a failed process check as "not running" and still starts', async () => {
    const openExternal = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined)
    const launcher = new GameLauncher({
      isRunning: () => Promise.reject(new Error('no process list')),
      openExternal,
      joins: new JoinCoordinator(() => 0)
    })
    await expect(launcher.start('vrchat')).resolves.toEqual({ ok: true, state: 'started' })
  })

  it('waits out a Join that is being delivered on the same platform, and holds one back', async () => {
    const { launcher, openExternal, joins } = setup()
    const join = joins.acquire('vrchat', 'world:room', 'friend')!
    await expect(launcher.start('vrchat')).resolves.toEqual({ ok: false, reason: 'cooldown' })
    expect(openExternal).not.toHaveBeenCalled()
    // The other platform is free.
    await expect(launcher.start('chilloutvr')).resolves.toEqual({ ok: true, state: 'started' })
    join.release()

    // While a start is in flight, a Join on that platform waits; afterwards it is free.
    let finishOpen: () => void = () => undefined
    openExternal.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishOpen = resolve
        })
    )
    const starting = launcher.start('vrchat')
    await vi.waitFor(() => expect(openExternal).toHaveBeenCalledTimes(2))
    expect(joins.acquire('vrchat', 'world:room', 'friend')).toBeNull()
    finishOpen()
    await expect(starting).resolves.toEqual({ ok: true, state: 'started' })
    expect(joins.acquire('vrchat', 'world:room', 'friend')).not.toBeNull()
  })
})
