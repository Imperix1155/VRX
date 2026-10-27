import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server, type Socket } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  GameHandoff,
  RunningGames,
  parseTasklistNames,
  processNameListerFor,
  sendToVrchatUrlPipe,
  VRCHAT_URL_PIPE,
  type GameHandoffSettings
} from './gameHandoff'

describe('parseTasklistNames', () => {
  it('reads the image name column, case-folded, and skips the no-match notice', () => {
    const stdout = [
      '"System Idle Process","0","Services","0","8 K"',
      '"VRChat.exe","4242","Console","1","1,234,567 K"',
      '"ChilloutVR.exe","5151","Console","1","987,654 K"',
      'INFO: No tasks are running which match the specified criteria.',
      ''
    ].join('\r\n')
    expect(parseTasklistNames(stdout)).toEqual([
      'system idle process',
      'vrchat.exe',
      'chilloutvr.exe'
    ])
  })
})

describe('RunningGames', () => {
  it('matches exact image names for each platform from one shared list', async () => {
    const list = vi.fn().mockResolvedValue(['vrchat.exe', 'notchilloutvr.exe'])
    const games = new RunningGames(list, () => 0)
    await expect(games.isRunning('vrchat')).resolves.toBe(true)
    await expect(games.isRunning('chilloutvr')).resolves.toBe(false)
    expect(list).toHaveBeenCalledOnce()
  })

  it('caches briefly, shares one read between callers, and treats a failed read as nothing running', async () => {
    let now = 0
    const list = vi
      .fn<() => Promise<string[]>>()
      .mockRejectedValueOnce(new Error('denied'))
      .mockResolvedValue(['chilloutvr.exe'])
    const games = new RunningGames(list, () => now)
    const [a, b] = await Promise.all([games.isRunning('vrchat'), games.isRunning('chilloutvr')])
    expect([a, b]).toEqual([false, false])
    expect(list).toHaveBeenCalledOnce()
    now = 1_999
    await expect(games.isRunning('chilloutvr')).resolves.toBe(false)
    now = 2_000
    await expect(games.isRunning('chilloutvr')).resolves.toBe(true)
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('reports nothing running on macOS without reading processes', async () => {
    await expect(processNameListerFor('darwin')()).resolves.toEqual([])
  })

  it('reads Linux process names from /proc', async () => {
    if (process.platform !== 'linux') return
    const names = await processNameListerFor('linux')()
    // The test runner itself is a node process.
    expect(names.some((name) => name.startsWith('node') || name.includes('vitest'))).toBe(true)
  })
})

describe('sendToVrchatUrlPipe', () => {
  it('targets the pipe VRChat’s launcher uses', () => {
    expect(VRCHAT_URL_PIPE).toBe(['', '', '.', 'pipe', 'VRChatURLLaunchPipe'].join('\\'))
  })

  let server: Server | null = null
  let dir: string | null = null
  const sockets: Socket[] = []

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.destroy()
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
    server = null
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = null
  })

  async function listen(reply: (url: string) => number | null | 'silent'): Promise<{
    path: string
    received: string[]
  }> {
    dir = mkdtempSync(join(tmpdir(), 'vrx-pipe-'))
    const path = join(dir, 'pipe.sock')
    const received: string[] = []
    server = createServer((socket) => {
      sockets.push(socket)
      socket.once('data', (chunk) => {
        const url = chunk.toString('utf8')
        received.push(url)
        const byte = reply(url)
        if (byte === 'silent') return
        if (byte === null) socket.end()
        else socket.write(Buffer.from([byte]))
      })
    })
    await new Promise<void>((resolve) => server!.listen(path, resolve))
    return { path, received }
  }

  const url = 'vrchat://launch?ref=vrchat.com&id=wrld_example:12345~friends(usr_x)'

  it('sends the URL and accepts only the game’s 1 byte', async () => {
    const accepted = await listen(() => 1)
    await expect(sendToVrchatUrlPipe(url, accepted.path)).resolves.toBe(true)
    expect(accepted.received).toEqual([url])
  })

  it('treats any other answer, a hang-up, or no pipe as not taken', async () => {
    const refused = await listen(() => 0)
    await expect(sendToVrchatUrlPipe(url, refused.path)).resolves.toBe(false)
    await new Promise<void>((resolve) => server!.close(() => resolve()))
    const hungUp = await listen(() => null)
    await expect(sendToVrchatUrlPipe(url, hungUp.path)).resolves.toBe(false)
    await expect(sendToVrchatUrlPipe(url, join(tmpdir(), 'vrx-no-such-pipe'))).resolves.toBe(false)
  })

  it('gives up after the timeout when the game never answers', async () => {
    const silent = await listen(() => 'silent')
    await expect(sendToVrchatUrlPipe(url, silent.path, 50)).resolves.toBe(false)
  })
})

describe('GameHandoff', () => {
  const current = (): boolean => true
  function handoff(
    overrides: {
      running?: boolean
      settings?: GameHandoffSettings
      host?: NodeJS.Platform
      openExternal?: (url: string) => Promise<void>
      sendToVrchat?: (url: string) => Promise<boolean>
    } = {}
  ): GameHandoff {
    return new GameHandoff({
      hostPlatform: overrides.host ?? 'win32',
      isRunning: async () => overrides.running ?? true,
      settings: () => overrides.settings ?? { joinOpenGame: true, vrchatOpenGameJoin: 'go' },
      openExternal: overrides.openExternal ?? (async () => undefined),
      sendToVrchat: overrides.sendToVrchat ?? (async () => true)
    })
  }

  it('previews the same path for both platforms when each game is open', async () => {
    await expect(handoff().preview('vrchat')).resolves.toBe('in-game')
    await expect(handoff().preview('chilloutvr')).resolves.toBe('in-game')
    await expect(handoff({ host: 'linux' }).preview('chilloutvr')).resolves.toBe('in-game')
    await expect(handoff({ host: 'linux' }).preview('vrchat')).resolves.toBe('invite')
    await expect(handoff({ running: false }).preview('chilloutvr')).resolves.toBe('launch')
  })

  it('reports launch-failed when the system cannot open the link', async () => {
    const result = await handoff({
      running: false,
      openExternal: async () => {
        throw new Error('no handler')
      }
    }).deliver(
      'chilloutvr',
      'chilloutvr://instance/join?instanceId=x',
      async () => undefined,
      current
    )
    expect(result).toEqual({ ok: false, reason: 'launch-failed' })
  })

  it('falls back to the invite when the pipe throws', async () => {
    const invite = vi.fn().mockResolvedValue(undefined)
    const result = await handoff({
      sendToVrchat: async () => {
        throw new Error('pipe')
      }
    }).deliver('vrchat', 'vrchat://launch?id=x', invite, current)
    expect(result).toEqual({ ok: true, handoff: 'invite' })
    expect(invite).toHaveBeenCalledOnce()
  })

  it('launches when the process check fails', async () => {
    const open = vi.fn().mockResolvedValue(undefined)
    const games = new GameHandoff({
      hostPlatform: 'win32',
      isRunning: async () => {
        throw new Error('tasklist missing')
      },
      settings: () => ({ joinOpenGame: true, vrchatOpenGameJoin: 'go' }),
      openExternal: open
    })
    await expect(
      games.deliver('vrchat', 'vrchat://launch?id=x', vi.fn(), current)
    ).resolves.toEqual({ ok: true, handoff: 'launch' })
    expect(open).toHaveBeenCalledOnce()
  })

  it('launches nothing when the account changes during the process check', async () => {
    const open = vi.fn().mockResolvedValue(undefined)
    let signedIn = true
    const games = new GameHandoff({
      hostPlatform: 'win32',
      isRunning: async () => {
        signedIn = false
        return false
      },
      settings: () => ({ joinOpenGame: true, vrchatOpenGameJoin: 'go' }),
      openExternal: open
    })
    for (const platform of ['vrchat', 'chilloutvr'] as const) {
      signedIn = true
      await expect(
        games.deliver(platform, `${platform}://x`, vi.fn(), () => signedIn)
      ).resolves.toEqual({ ok: false, reason: 'stale' })
    }
    expect(open).not.toHaveBeenCalled()
  })

  it('sends no invite when the account changes while the pipe answers', async () => {
    const invite = vi.fn().mockResolvedValue(undefined)
    let signedIn = true
    const result = await handoff({
      sendToVrchat: async () => {
        signedIn = false
        return false
      }
    }).deliver('vrchat', 'vrchat://launch?id=x', invite, () => signedIn)
    expect(result).toEqual({ ok: false, reason: 'stale' })
    expect(invite).not.toHaveBeenCalled()
  })
})
