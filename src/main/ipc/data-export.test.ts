import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import type { DataExportResult } from '@shared/ipc'
import type { DataExportSources } from '../services/dataExport'

const handlers = new Map<string, (event: unknown, req?: unknown) => unknown>()
const trusted = vi.hoisted(() => ({ value: true }))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, fn: (event: unknown, req?: unknown) => unknown) => {
      handlers.set(channel, fn)
    })
  }
}))
vi.mock('./security', () => ({ isTrustedIpcSender: vi.fn(() => trusted.value) }))

import { registerDataExportHandlers } from './data-export'

const event = { senderFrame: {} } as unknown as IpcMainInvokeEvent
type SaveFile = (event: IpcMainInvokeEvent, name: string, content: string) => Promise<boolean>
let saveFile: ReturnType<typeof vi.fn<SaveFile>>
let signedIn: boolean
let rosterLoaded: boolean
let reads: number
let favoritesLoaded: boolean
let prepare: ReturnType<typeof vi.fn<() => Promise<void>>>
const emptyFavorites = {
  groups: { friend: [], world: [] },
  friends: {},
  worlds: {},
  worldNames: []
}

function sources(): DataExportSources {
  return {
    accountId: (platform) => {
      reads += 1
      return signedIn && platform === 'vrchat' ? 'usr_me' : null
    },
    roster: () => (rosterLoaded ? [{ id: 'usr_a', name: 'Ari' }] : null),
    favoriteFriendIds: () => ['usr_a'],
    favoriteWorlds: () => [],
    notes: () => ({ usr_a: 'hello' }),
    gameFavorites: () => (favoritesLoaded ? emptyFavorites : 'unavailable'),
    linkedProfiles: () => [],
    now: () => new Date(2026, 10, 11, 9, 30)
  }
}

const run = (req?: unknown): Promise<DataExportResult> =>
  handlers.get('export-data')!(event, req) as Promise<DataExportResult>

beforeEach(() => {
  handlers.clear()
  trusted.value = true
  signedIn = true
  rosterLoaded = true
  reads = 0
  favoritesLoaded = false
  // The favorites read lands while the export waits for it.
  prepare = vi.fn<() => Promise<void>>(async () => {
    favoritesLoaded = true
  })
  saveFile = vi.fn<SaveFile>(async () => true)
  registerDataExportHandlers({ sources: sources(), saveFile, prepare })
})

describe('export-data handler', () => {
  it('guards the sender before reading anything or opening a dialog', () => {
    trusted.value = false
    expect(() => handlers.get('export-data')!(event)).toThrow('Untrusted IPC sender')
    expect(reads).toBe(0)
    expect(saveFile).not.toHaveBeenCalled()
  })

  it('saves what main built under a dated name and answers with counts only', async () => {
    expect(await run()).toEqual({
      ok: true,
      friends: 1,
      notes: 1,
      favorites: 1,
      gameFavoritesMissing: false
    })
    expect(saveFile).toHaveBeenCalledTimes(1)
    const [, name, content] = saveFile.mock.calls[0]!
    expect(name).toBe('vrx-export-2026-11-11.json')
    const file = JSON.parse(content) as { vrchat: { friends: unknown[] }; chilloutvr: unknown }
    expect(file.vrchat.friends).toEqual([
      { id: 'usr_a', name: 'Ari', favorite: true, favoriteGroups: [], note: 'hello' }
    ])
    expect(file.chilloutvr).toBeNull()
  })

  it('takes no input: a request body cannot name a file or supply content', async () => {
    await run({ path: 'elsewhere.json', content: '{}', name: 'x' })
    const [, name, content] = saveFile.mock.calls[0]!
    expect(name).toBe('vrx-export-2026-11-11.json')
    expect(content).toContain('"app": "VRX"')
    expect(content).not.toContain('elsewhere')
  })

  it('opens no dialog and starts no read with no account', async () => {
    signedIn = false
    expect(await run()).toEqual({ ok: false, reason: 'signed-out' })
    expect(saveFile).not.toHaveBeenCalled()
    expect(prepare).not.toHaveBeenCalled()
  })

  it('opens no dialog before a friends list has arrived', async () => {
    rosterLoaded = false
    expect(await run()).toEqual({ ok: false, reason: 'not-ready' })
    expect(saveFile).not.toHaveBeenCalled()
    expect(prepare).not.toHaveBeenCalled()
  })

  it('waits for the favorites read once, before the file is built', async () => {
    await run()
    expect(prepare).toHaveBeenCalledTimes(1)
    const file = JSON.parse(saveFile.mock.calls[0]![2]) as { vrchat: { gameFavorites: string } }
    expect(file.vrchat.gameFavorites).toBe('included')
  })

  it('still saves, and says so, when the favorites could not be read', async () => {
    prepare.mockRejectedValue(new Error('read failed'))
    const result = await run()
    expect(result).toEqual({
      ok: true,
      friends: 1,
      notes: 1,
      favorites: 1,
      gameFavoritesMissing: true
    })
    const file = JSON.parse(saveFile.mock.calls[0]![2]) as { vrchat: { gameFavorites: string } }
    expect(file.vrchat.gameFavorites).toBe('unavailable')
  })

  it('works without a prepare step', async () => {
    handlers.clear()
    registerDataExportHandlers({ sources: sources(), saveFile })
    expect((await run()).ok).toBe(true)
  })

  it('reports a cancelled dialog as cancelled', async () => {
    saveFile.mockResolvedValue(false)
    expect(await run()).toEqual({ ok: false, reason: 'cancelled' })
  })

  it('reports a failed write with a typed reason and no detail', async () => {
    saveFile.mockRejectedValue(new Error('EACCES: somewhere private'))
    const result = await run()
    expect(result).toEqual({ ok: false, reason: 'save-failed' })
    expect(JSON.stringify(result)).not.toContain('private')
  })

  it('shows one dialog at a time: presses while it is open join the first', async () => {
    let finish: (saved: boolean) => void = () => undefined
    saveFile.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve
        })
    )
    const first = run()
    const second = run()
    const third = run()
    await vi.waitFor(() => expect(saveFile).toHaveBeenCalledTimes(1))
    finish(true)
    const results = await Promise.all([first, second, third])
    expect(results.every((result) => result.ok)).toBe(true)

    saveFile.mockResolvedValue(true)
    await run()
    expect(saveFile).toHaveBeenCalledTimes(2)
  })
})
