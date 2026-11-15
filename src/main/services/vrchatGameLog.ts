/**
 * VRChat's own log file, read for the instance log (owner approved,
 * 2026-11-15). VRChat tells no app over the network who is in the user's
 * room; the game writes it to a text file on this computer, and VRCX reads
 * the same file for the same reason.
 *
 * Read-only, and only these lines: who signed in to the game, the room
 * entered, players joining and leaving, leaving the room, the game closing.
 * Nothing else in the file is kept, nothing is ever written to VRChat's
 * folder, and no line is logged. Rows are saved only when the account signed
 * in to the game is the account signed in to VRX.
 *
 * The whole file is replayed after a restart; `InstanceLog` saves nothing
 * twice.
 */
import { lstat, open, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'

/** VRChat's line prefix is a fixed width: time, level, " -  ". */
const MESSAGE_OFFSET = 34
const BEHAVIOUR = '[Behaviour] '
const QUIT = 'VRCApplication: HandleApplicationQuit'
const STAMP = /^(\d{4})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2}):(\d{2}) /
/** "Name (usr_…)": the id is the last bracket, so a name may hold brackets. */
const PLAYER = /^(.*) \(([A-Za-z0-9_-]{1,64})\)$/
const LOG_FILE = /^output_log_[0-9_-]+\.txt$/
/** Lines longer than this are not ones VRX reads. */
const MAX_LINE_LENGTH = 1_024
const CHUNK_BYTES = 1_048_576
/** Most bytes read in one pass, so a huge log never holds main for long. */
const MAX_BYTES_PER_PASS = 32 * CHUNK_BYTES
/** Newest log files looked at. VRChat keeps only a few itself. */
const MAX_FILES = 8
/** How often the folder is looked at. Local files only; no request is made. */
export const VRCHAT_LOG_INTERVAL_MS = 5_000
/** A room with no new log lines for this long gets a "is the game still open" check. */
const QUIET_BEFORE_RUNNING_CHECK_MS = 60_000

export type VrchatLogEvent =
  | { type: 'user'; userId: string }
  | { type: 'world-name'; worldName: string; at: number }
  | { type: 'enter'; instanceId: string; at: number }
  | { type: 'joined'; platformUserId: string; displayName: string; at: number }
  | { type: 'left'; platformUserId: string; at: number }
  | { type: 'exit'; at: number }

/** One line of VRChat's log, or null for a line VRX does not read. */
export function parseVrchatLogLine(line: string): VrchatLogEvent | null {
  if (line.length <= MESSAGE_OFFSET || line.length > MAX_LINE_LENGTH) return null
  const isBehaviour = line.startsWith(BEHAVIOUR, MESSAGE_OFFSET)
  if (!isBehaviour && !line.startsWith(QUIT, MESSAGE_OFFSET)) return null
  const stamp = STAMP.exec(line)
  if (stamp === null) return null
  // The game writes local time.
  const at = new Date(
    Number(stamp[1]),
    Number(stamp[2]) - 1,
    Number(stamp[3]),
    Number(stamp[4]),
    Number(stamp[5]),
    Number(stamp[6])
  ).getTime()
  if (!Number.isFinite(at)) return null
  if (!isBehaviour) return { type: 'exit', at }

  const message = line.slice(MESSAGE_OFFSET + BEHAVIOUR.length).trimEnd()
  if (message.startsWith('OnPlayerJoined ')) {
    const player = readPlayer(message.slice('OnPlayerJoined '.length))
    if (player === null || player.displayName.trim() === '') return null
    return { type: 'joined', ...player, at }
  }
  if (message.startsWith('OnPlayerLeft ')) {
    const player = readPlayer(message.slice('OnPlayerLeft '.length))
    return player === null ? null : { type: 'left', platformUserId: player.platformUserId, at }
  }
  if (message.startsWith('Entering Room: ')) {
    const worldName = message.slice('Entering Room: '.length).trim()
    return worldName === '' ? null : { type: 'world-name', worldName, at }
  }
  if (message.startsWith('Joining wrld_')) {
    // The room's own id only: the one-time join code after it is never kept.
    const instanceId = message
      .slice('Joining '.length)
      .trim()
      .replace(/~nonce\([^)]*\)/g, '')
    return /^wrld_[A-Za-z0-9-]+(:.*)?$/.test(instanceId) ? { type: 'enter', instanceId, at } : null
  }
  if (message === 'OnLeftRoom') return { type: 'exit', at }
  if (message.startsWith('User Authenticated: ')) {
    const player = readPlayer(message.slice('User Authenticated: '.length))
    return player === null ? null : { type: 'user', userId: player.platformUserId }
  }
  return null
}

function readPlayer(text: string): { displayName: string; platformUserId: string } | null {
  const match = PLAYER.exec(text)
  const displayName = match?.[1]
  const platformUserId = match?.[2]
  return displayName === undefined || platformUserId === undefined
    ? null
    : { displayName, platformUserId }
}

/** Where VRChat keeps its log on this kind of computer. */
export function vrchatLogDirectories(host: NodeJS.Platform, home: string): string[] {
  const inProfile = ['AppData', 'LocalLow', 'VRChat', 'VRChat']
  if (host === 'win32') return [join(home, ...inProfile)]
  if (host !== 'linux') return []
  // VRChat under Steam's compatibility layer.
  const inSteam = [
    'steamapps',
    'compatdata',
    '438100',
    'pfx',
    'drive_c',
    'users',
    'steamuser',
    ...inProfile
  ]
  return [
    join(home, '.local', 'share', 'Steam', ...inSteam),
    join(home, '.steam', 'steam', ...inSteam),
    join(home, '.var', 'app', 'com.valvesoftware.Steam', '.local', 'share', 'Steam', ...inSteam)
  ]
}

/** What the reader tells: the instance log's own steps. */
export interface VrchatGameLogSink {
  batch(step: () => void): void
  enter(
    platform: 'vrchat',
    room: { instanceId: string; worldName: string | null; at: number }
  ): void
  nameWorld(platform: 'vrchat', worldName: string): void
  join(
    platform: 'vrchat',
    person: { platformUserId: string; displayName: string; at: number }
  ): void
  leave(platform: 'vrchat', platformUserId: string, at: number): void
  exit(platform: 'vrchat', at: number): void
}

export interface VrchatGameLogOptions {
  /** Folders to look in, first match wins. */
  directories: readonly string[]
  /** The VRChat account signed in to VRX (`usr_…`), or null. */
  accountId: () => string | null
  /** Read at each pass: whether an instance log is kept at all. */
  isEnabled: () => boolean
  /** Whether VRChat is open, for a room that has gone quiet. */
  isGameRunning: () => Promise<boolean>
  sink: VrchatGameLogSink
  now?: () => number
}

interface FileState {
  offset: number
  decoder: StringDecoder
  /** The start of a line whose end has not been written yet. */
  carry: string
  /** Who signed in to the game in this file; null until the file says. */
  user: string | null
  worldName: string | null
  inRoom: boolean
  /** The time on the last line read. */
  lastAt: number
  /** When the file last grew, on VRX's clock. */
  grewAt: number
  done: boolean
}

export class VrchatGameLog {
  private readonly files = new Map<string, FileState>()
  private timer: ReturnType<typeof setInterval> | null = null
  private running: Promise<void> | null = null
  private directory: string | null = null
  private readonly now: () => number

  constructor(private readonly options: VrchatGameLogOptions) {
    this.now = options.now ?? Date.now
  }

  start(): void {
    if (this.timer !== null || this.options.directories.length === 0) return
    this.timer = setInterval(() => void this.pass(), VRCHAT_LOG_INTERVAL_MS)
    this.timer.unref()
    void this.pass()
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
  }

  /** An account boundary, or saving turned off: read from the start next time. */
  reset(): void {
    this.files.clear()
  }

  /** One look at the folder. Passes never overlap, and never throw. */
  pass(): Promise<void> {
    this.running ??= this.read()
      .catch(() => undefined)
      .finally(() => {
        this.running = null
      })
    return this.running
  }

  private async read(): Promise<void> {
    if (!this.options.isEnabled()) {
      this.files.clear()
      return
    }
    const accountId = this.options.accountId()
    if (accountId === null) return
    const directory = await this.findDirectory()
    if (directory === null) return
    const names = (await readdir(directory))
      .filter((name) => LOG_FILE.test(name))
      .sort()
      .slice(-MAX_FILES)
    for (const name of [...this.files.keys()]) {
      if (!names.includes(name)) this.files.delete(name)
    }
    let budget = MAX_BYTES_PER_PASS
    for (const [index, name] of names.entries()) {
      const newest = index === names.length - 1
      const state = this.stateOf(name)
      if (state.done) continue
      const atEnd = await this.readFile(join(directory, name), state, accountId, budget)
      if (atEnd === null) return
      budget -= atEnd.read
      if (!atEnd.reachedEnd) return
      if (!newest) {
        // A game session that is over: a room never left ended with it.
        if (state.inRoom && this.mayRecord(state, accountId)) {
          this.options.sink.exit('vrchat', state.lastAt)
        }
        state.inRoom = false
        state.done = true
      } else if (state.inRoom && this.now() - state.grewAt >= QUIET_BEFORE_RUNNING_CHECK_MS) {
        state.grewAt = this.now()
        if (!(await this.options.isGameRunning())) {
          if (this.mayRecord(state, accountId)) this.options.sink.exit('vrchat', state.lastAt)
          state.inRoom = false
        }
      }
    }
  }

  private stateOf(name: string): FileState {
    let state = this.files.get(name)
    if (state === undefined) {
      state = {
        offset: 0,
        decoder: new StringDecoder('utf8'),
        carry: '',
        user: null,
        worldName: null,
        inRoom: false,
        lastAt: 0,
        grewAt: this.now(),
        done: false
      }
      this.files.set(name, state)
    }
    return state
  }

  /** Read what was added to one file. Null when it cannot be read right now. */
  private async readFile(
    path: string,
    state: FileState,
    accountId: string,
    budget: number
  ): Promise<{ read: number; reachedEnd: boolean } | null> {
    let handle
    try {
      // A plain file only: never a link out of the folder.
      const info = await lstat(path)
      if (!info.isFile()) return null
      if (info.size < state.offset) {
        // Replaced by a shorter file: start it again.
        Object.assign(state, {
          offset: 0,
          carry: '',
          user: null,
          worldName: null,
          inRoom: false,
          decoder: new StringDecoder('utf8')
        })
      }
      if (info.size === state.offset) return { read: 0, reachedEnd: true }
      handle = await open(path, 'r')
      const buffer = Buffer.allocUnsafe(CHUNK_BYTES)
      let read = 0
      while (read < budget) {
        const { bytesRead } = await handle.read(buffer, 0, CHUNK_BYTES, state.offset)
        if (bytesRead === 0) return { read, reachedEnd: true }
        state.offset += bytesRead
        read += bytesRead
        state.grewAt = this.now()
        this.take(state.decoder.write(buffer.subarray(0, bytesRead)), state, accountId)
      }
      return { read, reachedEnd: false }
    } catch {
      return null
    } finally {
      await handle?.close().catch(() => undefined)
    }
  }

  /** Split new text into whole lines and tell the sink what they say. */
  private take(text: string, state: FileState, accountId: string): void {
    const lines = (state.carry + text).split('\n')
    const rest = lines.pop() ?? ''
    // A line this long is not one VRX reads; drop its start, keep reading.
    state.carry = rest.length > MAX_LINE_LENGTH ? '' : rest
    const sink = this.options.sink
    sink.batch(() => {
      for (const raw of lines) {
        const event = parseVrchatLogLine(raw.endsWith('\r') ? raw.slice(0, -1) : raw)
        if (event === null) continue
        if (event.type === 'user') {
          state.user = event.userId
          continue
        }
        state.lastAt = event.at
        const record = this.mayRecord(state, accountId)
        switch (event.type) {
          case 'world-name':
            state.worldName = event.worldName
            break
          case 'enter':
            state.inRoom = true
            if (record) {
              sink.enter('vrchat', {
                instanceId: event.instanceId,
                worldName: state.worldName,
                at: event.at
              })
            }
            state.worldName = null
            break
          case 'joined':
            if (record && state.inRoom) sink.join('vrchat', event)
            break
          case 'left':
            if (record && state.inRoom) sink.leave('vrchat', event.platformUserId, event.at)
            break
          case 'exit':
            if (record && state.inRoom) sink.exit('vrchat', event.at)
            state.inRoom = false
            break
        }
      }
    })
  }

  /** Rows are saved only for the account signed in to both the game and VRX.
   *  A file that never said who signed in is taken as the VRX account's. */
  private mayRecord(state: FileState, accountId: string): boolean {
    return state.user === null || state.user === accountId
  }

  private async findDirectory(): Promise<string | null> {
    if (this.directory !== null) return this.directory
    for (const candidate of this.options.directories) {
      try {
        // The user's own folder, wherever they keep it.
        if ((await stat(candidate)).isDirectory()) {
          this.directory = candidate
          return candidate
        }
      } catch {
        // Not there: VRChat is not installed here, or not in this place.
      }
    }
    return null
  }
}
