/**
 * Join in a game that is already open (owner, 2026-10-27).
 *
 * VRCX and CVRX both check whether the game is running before a Join and, if
 * it is, send the player there instead of starting a second copy. VRX does the
 * same for both platforms:
 *
 * - ChilloutVR: the running game picks up its own `chilloutvr://` join link,
 *   so the link is opened as usual (CVRX does this; VR/desktop no longer
 *   applies).
 * - VRChat on Windows: the launch URL goes to the running game over VRChat's
 *   local URL pipe, which answers with one byte (1 = accepted), as VRCX does.
 * - VRChat otherwise (pipe refused, Linux/Proton where the pipe sits inside the
 *   game's container, or the user picked invites): one self-invite, which the
 *   player accepts in the game.
 *
 * Everything here is local except that self-invite, the one platform write
 * VRX already makes. The process check reads only image names and never logs
 * them.
 */
import { execFile } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { connect } from 'node:net'
import type { JoinHandoff, Platform, VrchatOpenGameJoin } from '@shared/types'

/** Image names as Windows reports them; Wine/Proton uses the same `comm`. */
const GAME_PROCESS_NAMES: Record<Platform, string> = {
  vrchat: 'vrchat.exe',
  chilloutvr: 'chilloutvr.exe'
}

/** VRChat's own launcher hands URLs to the running game through this pipe. */
export const VRCHAT_URL_PIPE = String.raw`\\.\pipe\VRChatURLLaunchPipe`

const PROCESS_CHECK_TTL_MS = 2_000
const PROCESS_LIST_TIMEOUT_MS = 3_000
const PIPE_TIMEOUT_MS = 3_000
/** No real host comes close; bounds memory if `/proc` is unusual. */
const MAX_PROCESS_ENTRIES = 20_000

/** Lower-cased process image names, or an empty list when they can't be read. */
export type ProcessNameLister = () => Promise<string[]>

/** Parse `tasklist /FO CSV /NH` output: the first quoted field is the image name. */
export function parseTasklistNames(stdout: string): string[] {
  const names: string[] = []
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^"([^"]+)"/.exec(line)
    if (match?.[1]) names.push(match[1].toLowerCase())
  }
  return names
}

function listWindowsProcessNames(): Promise<string[]> {
  return new Promise((resolve) => {
    execFile(
      'tasklist',
      ['/FO', 'CSV', '/NH'],
      { windowsHide: true, timeout: PROCESS_LIST_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout) => resolve(error ? [] : parseTasklistNames(String(stdout)))
    )
  })
}

async function listLinuxProcessNames(): Promise<string[]> {
  let entries: string[]
  try {
    entries = await readdir('/proc')
  } catch {
    return []
  }
  const pids = entries.filter((entry) => /^\d+$/.test(entry)).slice(0, MAX_PROCESS_ENTRIES)
  const names = await Promise.all(
    pids.map((pid) =>
      readFile(`/proc/${pid}/comm`, 'utf8').then(
        (name) => name.trim().toLowerCase(),
        // The process ended between readdir and read, or isn't ours to see.
        () => ''
      )
    )
  )
  return names.filter((name) => name !== '')
}

/** The host's process lister. macOS is not a game platform: nothing runs there. */
export function processNameListerFor(hostPlatform: NodeJS.Platform): ProcessNameLister {
  if (hostPlatform === 'win32') return listWindowsProcessNames
  if (hostPlatform === 'linux') return listLinuxProcessNames
  return () => Promise.resolve([])
}

/** Which games run now, from one cached process list shared by both platforms. */
export class RunningGames {
  private cached: { at: number; names: Set<string> } | null = null
  private inFlight: Promise<Set<string>> | null = null

  constructor(
    private readonly list: ProcessNameLister,
    private readonly clock: () => number = () => performance.now()
  ) {}

  async isRunning(platform: Platform): Promise<boolean> {
    return (await this.names()).has(GAME_PROCESS_NAMES[platform])
  }

  private async names(): Promise<Set<string>> {
    if (this.cached && this.clock() - this.cached.at < PROCESS_CHECK_TTL_MS) {
      return this.cached.names
    }
    if (this.inFlight) return this.inFlight
    this.inFlight = this.list()
      .catch(() => [] as string[])
      .then((names) => {
        const set = new Set(names)
        this.cached = { at: this.clock(), names: set }
        return set
      })
      .finally(() => {
        this.inFlight = null
      })
    return this.inFlight
  }
}

/**
 * Hand a launch URL to the running VRChat. True only when the game says it
 * took it. `stillCurrent` is checked once the pipe connects, right before the
 * write, so a sign-in change while connecting sends nothing.
 */
export function sendToVrchatUrlPipe(
  url: string,
  pipePath: string = VRCHAT_URL_PIPE,
  timeoutMs: number = PIPE_TIMEOUT_MS,
  stillCurrent: () => boolean = () => true
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const socket = connect(pipePath)
    const finish = (accepted: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      resolve(accepted)
    }
    const timer = setTimeout(() => finish(false), timeoutMs)
    socket.once('connect', () => {
      if (stillCurrent()) socket.write(Buffer.from(url, 'utf8'))
      else finish(false)
    })
    socket.once('data', (chunk: Buffer) => finish(chunk[0] === 1))
    socket.once('error', () => finish(false))
    socket.once('close', () => finish(false))
  })
}

export interface GameHandoffSettings {
  joinOpenGame: boolean
  vrchatOpenGameJoin: VrchatOpenGameJoin
}

export interface GameHandoffOptions {
  hostPlatform: NodeJS.Platform
  isRunning: (platform: Platform) => Promise<boolean>
  settings: () => GameHandoffSettings
  openExternal: (url: string) => Promise<void>
  sendToVrchat?: (url: string, stillCurrent: () => boolean) => Promise<boolean>
}

export type HandoffResult =
  | { ok: true; handoff: JoinHandoff }
  | { ok: false; reason: 'launch-failed' | 'invite-failed' | 'stale' }

/** A Join's last step: launch, or reach the copy of the game that is already open. */
export class GameHandoff {
  private readonly sendToVrchat: (url: string, stillCurrent: () => boolean) => Promise<boolean>

  constructor(private readonly options: GameHandoffOptions) {
    this.sendToVrchat =
      options.sendToVrchat ??
      ((url, stillCurrent) => sendToVrchatUrlPipe(url, undefined, undefined, stillCurrent))
  }

  /** What a Join would do now. Main decides again at Join time. */
  async preview(platform: Platform): Promise<JoinHandoff> {
    if (!(await this.joinsOpenGame(platform))) return 'launch'
    return platform === 'vrchat' && !this.canHandVrchatUrl() ? 'invite' : 'in-game'
  }

  /**
   * Deliver a Join. `url` must already have passed `isAllowedLaunchUrl`;
   * `selfInvite` is the adapter's, for the same main-owned location.
   * `stillCurrent` is the caller's account fence: it is checked again after
   * every wait, so a sign-in change mid-Join launches and invites nothing.
   */
  async deliver(
    platform: Platform,
    url: string,
    selfInvite: () => Promise<void>,
    stillCurrent: () => boolean
  ): Promise<HandoffResult> {
    const openGame = await this.joinsOpenGame(platform)
    if (!stillCurrent()) return { ok: false, reason: 'stale' }
    if (!openGame || platform === 'chilloutvr') {
      try {
        await this.options.openExternal(url)
      } catch {
        return { ok: false, reason: 'launch-failed' }
      }
      return { ok: true, handoff: openGame ? 'in-game' : 'launch' }
    }
    if (
      this.canHandVrchatUrl() &&
      (await this.sendToVrchat(url, stillCurrent).catch(() => false))
    ) {
      return { ok: true, handoff: 'in-game' }
    }
    if (!stillCurrent()) return { ok: false, reason: 'stale' }
    try {
      await selfInvite()
    } catch {
      return { ok: false, reason: 'invite-failed' }
    }
    return { ok: true, handoff: 'invite' }
  }

  private async joinsOpenGame(platform: Platform): Promise<boolean> {
    if (!this.options.settings().joinOpenGame) return false
    return this.options.isRunning(platform).catch(() => false)
  }

  private canHandVrchatUrl(): boolean {
    return (
      this.options.hostPlatform === 'win32' && this.options.settings().vrchatOpenGameJoin === 'go'
    )
  }
}
