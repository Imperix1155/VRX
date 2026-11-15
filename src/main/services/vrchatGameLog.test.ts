import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  VrchatGameLog,
  parseVrchatLogLine,
  vrchatLogDirectories,
  type VrchatGameLogSink
} from './vrchatGameLog'

const ME = 'usr_11111111-1111-4111-8111-111111111111'
const ALICE = 'usr_22222222-2222-4222-8222-222222222222'

/** A line as VRChat writes it: local time, a padded level, then the message. */
function line(time: string, message: string, level = 'Debug'): string {
  return `2026.11.15 ${time} ${level.padEnd(10)} -  ${message}`
}
const at = (time: string): number => {
  const [h, m, s] = time.split(':').map(Number)
  return new Date(2026, 10, 15, h, m, s).getTime()
}

describe('parseVrchatLogLine', () => {
  it('reads the lines the instance log needs', () => {
    expect(
      parseVrchatLogLine(line('12:00:00', `[Behaviour] User Authenticated: Me (${ME})`))
    ).toEqual({ type: 'user', userId: ME })
    expect(parseVrchatLogLine(line('12:00:01', '[Behaviour] Entering Room: Pug Lounge'))).toEqual({
      type: 'world-name',
      worldName: 'Pug Lounge',
      at: at('12:00:01')
    })
    expect(
      parseVrchatLogLine(
        line(
          '12:00:02',
          `[Behaviour] Joining wrld_aaaa-1:12345~private(${ME})~region(us)~nonce(SECRET-CODE)`
        )
      )
    ).toEqual({
      type: 'enter',
      instanceId: `wrld_aaaa-1:12345~private(${ME})~region(us)`,
      at: at('12:00:02')
    })
    expect(
      parseVrchatLogLine(line('12:00:03', `[Behaviour] OnPlayerJoined Alice (cool) (${ALICE})`))
    ).toEqual({
      type: 'joined',
      displayName: 'Alice (cool)',
      platformUserId: ALICE,
      at: at('12:00:03')
    })
    expect(
      parseVrchatLogLine(line('12:00:04', `[Behaviour] OnPlayerLeft Alice (${ALICE})`))
    ).toEqual({ type: 'left', platformUserId: ALICE, at: at('12:00:04') })
    expect(parseVrchatLogLine(line('12:00:05', '[Behaviour] OnLeftRoom'))).toEqual({
      type: 'exit',
      at: at('12:00:05')
    })
    expect(
      parseVrchatLogLine(line('12:00:06', 'VRCApplication: HandleApplicationQuit at 936.5', 'Log'))
    ).toEqual({ type: 'exit', at: at('12:00:06') })
  })

  it.each([
    ['an empty line', ''],
    ['a line without a time', `not a time at all, padded out      [Behaviour] OnLeftRoom`],
    ['another part of the game', line('12:00:00', '[Network] OnPlayerJoined Alice (usr_x)')],
    [
      'a joining line that is not a room',
      line('12:00:00', '[Behaviour] Joining or Creating Room: Pug')
    ],
    ['a friend join line', line('12:00:00', '[Behaviour] Joining friend: Alice')],
    ['a player line without an id', line('12:00:00', '[Behaviour] OnPlayerJoined Alice')],
    ['the room-left notice for a player', line('12:00:00', '[Behaviour] OnPlayerLeftRoom')],
    [
      'a message that only quotes the pattern',
      line('12:00:00', `[Chat] hello [Behaviour] OnPlayerJoined Eve (${ALICE})`)
    ],
    [
      'a very long line',
      line('12:00:00', `[Behaviour] OnPlayerJoined ${'a'.repeat(2_000)} (usr_x)`)
    ]
  ])('skips %s', (_label, text) => {
    expect(parseVrchatLogLine(text)).toBeNull()
  })
})

describe('vrchatLogDirectories', () => {
  it('knows where VRChat keeps its log on Windows and Linux, and nowhere else', () => {
    expect(vrchatLogDirectories('win32', join('profile', 'me'))).toHaveLength(1)
    expect(vrchatLogDirectories('linux', join('profile', 'me'))).toHaveLength(3)
    expect(
      vrchatLogDirectories('linux', join('profile', 'me')).every((path) => path.includes('438100'))
    ).toBe(true)
    expect(vrchatLogDirectories('darwin', join('profile', 'me'))).toEqual([])
  })
})

describe('VrchatGameLog', () => {
  let dir: string
  let steps: string[]
  let sink: VrchatGameLogSink
  let accountId: string | null
  let enabled: boolean
  let gameRunning: boolean
  let now: number

  const reader = (): VrchatGameLog =>
    new VrchatGameLog({
      directories: [join(dir, 'missing'), dir],
      accountId: () => accountId,
      isEnabled: () => enabled,
      isGameRunning: () => Promise.resolve(gameRunning),
      sink,
      now: () => now
    })
  const write = (name: string, lines: string[]): void =>
    writeFileSync(join(dir, name), lines.map((text) => `${text}\r\n`).join(''))

  const session = [
    line('12:00:00', `[Behaviour] User Authenticated: Me (${ME})`),
    line('12:00:01', '[Behaviour] Entering Room: Pug Lounge'),
    line('12:00:02', '[Behaviour] Joining wrld_a:1~region(us)'),
    line('12:00:03', `[Behaviour] OnPlayerJoined Me (${ME})`),
    line('12:00:04', `[Behaviour] OnPlayerJoined Alice (${ALICE})`),
    line('12:00:09', 'Some other line the reader has no use for', 'Log')
  ]

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vrx-vrchat-log-'))
    steps = []
    accountId = ME
    enabled = true
    gameRunning = true
    now = 1_000_000
    sink = {
      batch: (step) => step(),
      enter: (_platform, room) => steps.push(`enter ${room.instanceId} ${room.worldName}`),
      nameWorld: vi.fn(),
      join: (_platform, person) => steps.push(`join ${person.displayName}`),
      leave: (_platform, platformUserId) => steps.push(`leave ${platformUserId}`),
      exit: (_platform, time) => steps.push(`exit ${time}`)
    }
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('tells the room, who joined and who left, and only what was added since', async () => {
    write('output_log_2026-11-15_12-00-00.txt', session)
    const log = reader()
    await log.pass()
    expect(steps).toEqual(['enter wrld_a:1~region(us) Pug Lounge', 'join Me', 'join Alice'])

    await log.pass()
    expect(steps).toHaveLength(3)
    appendFileSync(
      join(dir, 'output_log_2026-11-15_12-00-00.txt'),
      `${line('12:05:00', `[Behaviour] OnPlayerLeft Alice (${ALICE})`)}\r\n${line('12:06:00', '[Behaviour] OnLeft')}`
    )
    await log.pass()
    // The last line is not finished yet: it waits for its end.
    expect(steps.slice(3)).toEqual([`leave ${ALICE}`])
    appendFileSync(join(dir, 'output_log_2026-11-15_12-00-00.txt'), 'Room\r\n')
    await log.pass()
    expect(steps.slice(4)).toEqual([`exit ${at('12:06:00')}`])
  })

  it('ends the room of a game session that is over, at its last line', async () => {
    write('output_log_2026-11-15_12-00-00.txt', session)
    write('output_log_2026-11-15_13-00-00.txt', [
      line('13:00:00', `[Behaviour] User Authenticated: Me (${ME})`)
    ])
    await reader().pass()
    expect(steps.at(-1)).toBe(`exit ${at('12:00:04')}`)
  })

  it('ends a quiet room once the game is no longer open', async () => {
    write('output_log_2026-11-15_12-00-00.txt', session)
    const log = reader()
    await log.pass()
    now += 61_000
    await log.pass()
    expect(steps).toHaveLength(3)

    gameRunning = false
    now += 61_000
    await log.pass()
    expect(steps.at(-1)).toBe(`exit ${at('12:00:04')}`)
  })

  it('saves nothing from a game signed in to another account', async () => {
    write('output_log_2026-11-15_12-00-00.txt', session)
    accountId = 'usr_someone-else'
    await reader().pass()
    expect(steps).toEqual([])
  })

  it('waits while no account is signed in, then reads from the start', async () => {
    write('output_log_2026-11-15_12-00-00.txt', session)
    accountId = null
    const log = reader()
    await log.pass()
    expect(steps).toEqual([])
    accountId = ME
    await log.pass()
    expect(steps).toHaveLength(3)
  })

  it('reads again from the start after a reset or after being turned off', async () => {
    write('output_log_2026-11-15_12-00-00.txt', session)
    const log = reader()
    await log.pass()
    log.reset()
    await log.pass()
    expect(steps).toHaveLength(6)

    enabled = false
    await log.pass()
    enabled = true
    await log.pass()
    expect(steps).toHaveLength(9)
  })

  it('tells nothing read for an account that is no longer the one signed in', async () => {
    write('output_log_2026-11-15_12-00-00.txt', session)
    const log = reader()
    const running = log.pass()
    // The account changes while the pass waits on the disk.
    accountId = 'usr_someone-else'
    await running
    expect(steps).toEqual([])
    // Nothing of that pass is kept: the file is read again for who is here now.
    await log.pass()
    expect(steps).toEqual([])
    accountId = ME
    log.reset()
    await log.pass()
    expect(steps).toHaveLength(3)
  })

  it('tells nothing from a pass that a reset overtook', async () => {
    write('output_log_2026-11-15_12-00-00.txt', session)
    const log = reader()
    const running = log.pass()
    log.reset()
    await running
    expect(steps).toEqual([])
    await log.pass()
    expect(steps).toHaveLength(3)
  })

  it('reads only VRChat log files, and never fails on a folder it cannot use', async () => {
    write('notes.txt', session)
    write('output_log_evil.txt.bak', session)
    await reader().pass()
    expect(steps).toEqual([])

    const nowhere = new VrchatGameLog({
      directories: [join(dir, 'missing')],
      accountId: () => ME,
      isEnabled: () => true,
      isGameRunning: () => Promise.resolve(true),
      sink
    })
    await expect(nowhere.pass()).resolves.toBeUndefined()
  })
})
