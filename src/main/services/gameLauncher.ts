/**
 * Quick launch (owner, 2026-11-18): start VRChat or ChilloutVR without joining
 * anyone, from the Dashboard's Quick launch row.
 *
 * Both games start the same way, through Steam, exactly as pressing Play
 * there would: Steam applies the player's own launch options and asks VR or
 * desktop when they have not chosen. Nothing here reaches either platform's
 * API, and the request names a platform and nothing else.
 *
 * A game that is already open is left alone. A second press shortly after a
 * start opens nothing more, because the game takes a while to appear in the
 * process list.
 */
import type { GameLaunchResult } from '@shared/ipc'
import type { Platform } from '@shared/types'
import { isAllowedGameStartUrl } from '../ipc/url-allowlist'
import type { JoinCoordinator } from './joinCoordinator'

/** Each game's Steam app id. */
export const STEAM_APP_IDS: Readonly<Record<Platform, number>> = {
  vrchat: 438100,
  chilloutvr: 661130
}

/** A press this soon after a start is the same start, not a second one. */
export const GAME_START_REPEAT_MS = 20_000

/** The join coordinator's key for a plain start (no destination). */
const START_KEY = 'start'

/** The link that starts a game the way Steam's Play button does. */
export function buildGameStartUrl(platform: Platform): string {
  return `steam://rungameid/${STEAM_APP_IDS[platform]}`
}

export interface GameLauncherOptions {
  isRunning: (platform: Platform) => Promise<boolean>
  openExternal: (url: string) => Promise<void>
  /** One launch per platform at a time, shared with Join: a start waits out a
   *  Join that is being delivered, and the other way round. */
  joins: Pick<JoinCoordinator, 'acquire'>
  /** False when this computer has nothing that opens the link. Defaults to true. */
  canOpen?: (url: string) => boolean
  clock?: () => number
}

export class GameLauncher {
  private readonly startedAt = new Map<Platform, number>()
  private readonly clock: () => number

  constructor(private readonly options: GameLauncherOptions) {
    this.clock = options.clock ?? (() => performance.now())
  }

  async start(platform: Platform): Promise<GameLaunchResult> {
    const permit = this.options.joins.acquire(platform, START_KEY)
    if (!permit) return { ok: false, reason: 'cooldown' }
    try {
      if (await this.options.isRunning(platform).catch(() => false)) {
        this.startedAt.delete(platform)
        return { ok: true, state: 'already-open' }
      }
      const last = this.startedAt.get(platform)
      if (last !== undefined && this.clock() - last < GAME_START_REPEAT_MS) {
        return { ok: true, state: 'starting' }
      }
      const url = buildGameStartUrl(platform)
      if (!isAllowedGameStartUrl(url) || this.options.canOpen?.(url) === false) {
        return { ok: false, reason: 'launch-failed' }
      }
      try {
        await this.options.openExternal(url)
      } catch {
        return { ok: false, reason: 'launch-failed' }
      }
      this.startedAt.set(platform, this.clock())
      return { ok: true, state: 'started' }
    } finally {
      permit.release()
    }
  }
}
