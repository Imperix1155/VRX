import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'

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

import {
  registerHistoryTransferHandlers,
  type HistoryTransferHandlerOptions
} from './history-transfer'

const event = { senderFrame: {} } as unknown as IpcMainInvokeEvent

function setup(overrides: Partial<HistoryTransferHandlerOptions> = {}): {
  options: HistoryTransferHandlerOptions
  call: (channel: string) => Promise<unknown>
} {
  const options: HistoryTransferHandlerOptions = {
    importVrcx: vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        friendsSince: 1,
        names: 2,
        visits: 3,
        olderSkipped: false,
        otherAccountSkipped: false
      })
    ),
    isKeeping: () => true,
    pickBackupTarget: vi.fn(() => Promise.resolve('/picked/backup.sqlite3')),
    pickBackupSource: vi.fn(() => Promise.resolve('/picked/backup.sqlite3')),
    backUp: vi.fn(() => Promise.resolve({ ok: true as const })),
    restore: vi.fn(() => Promise.resolve({ ok: true as const })),
    ...overrides
  }
  registerHistoryTransferHandlers(options)
  return {
    options,
    call: (channel) => Promise.resolve(handlers.get(channel)?.(event))
  }
}

beforeEach(() => {
  handlers.clear()
  trusted.value = true
})

describe('history transfer handlers', () => {
  it('refuses an untrusted sender on every channel', () => {
    setup()
    trusted.value = false
    for (const channel of ['import-vrcx-history', 'backup-history', 'restore-history']) {
      expect(() => handlers.get(channel)?.(event)).toThrow('Untrusted IPC sender')
    }
  })

  it('answers the import with what main counted', async () => {
    const { call } = setup()
    await expect(call('import-vrcx-history')).resolves.toEqual({
      ok: true,
      friendsSince: 1,
      names: 2,
      visits: 3,
      olderSkipped: false,
      otherAccountSkipped: false
    })
  })

  it('backs up to the path main picked, and only main picks it', async () => {
    const { call, options } = setup()
    await expect(call('backup-history')).resolves.toEqual({ ok: true })
    expect(options.backUp).toHaveBeenCalledWith('/picked/backup.sqlite3')
  })

  it('opens no dialog while history is not kept', async () => {
    const { call, options } = setup({ isKeeping: () => false })
    await expect(call('backup-history')).resolves.toEqual({ ok: false, reason: 'off' })
    await expect(call('restore-history')).resolves.toEqual({ ok: false, reason: 'off' })
    expect(options.pickBackupTarget).not.toHaveBeenCalled()
    expect(options.pickBackupSource).not.toHaveBeenCalled()
  })

  it('reports a cancelled dialog and touches nothing', async () => {
    const { call, options } = setup({
      pickBackupTarget: () => Promise.resolve(null),
      pickBackupSource: () => Promise.resolve(null)
    })
    await expect(call('backup-history')).resolves.toEqual({ ok: false, reason: 'cancelled' })
    await expect(call('restore-history')).resolves.toEqual({ ok: false, reason: 'cancelled' })
    expect(options.backUp).not.toHaveBeenCalled()
    expect(options.restore).not.toHaveBeenCalled()
  })

  it('runs one at a time, in the order pressed', async () => {
    const order: string[] = []
    let finishImport: () => void = () => undefined
    const { call } = setup({
      importVrcx: () =>
        new Promise((resolve) => {
          order.push('import starts')
          finishImport = () => {
            order.push('import ends')
            resolve({ ok: false, reason: 'no-history' })
          }
        }),
      restore: () => {
        order.push('restore')
        return Promise.resolve({ ok: true })
      }
    })
    const importing = call('import-vrcx-history')
    const restoring = call('restore-history')
    await Promise.resolve()
    await Promise.resolve()
    expect(order).toEqual(['import starts'])
    finishImport()
    await importing
    await restoring
    expect(order).toEqual(['import starts', 'import ends', 'restore'])
  })

  it('answers failed when a step throws, and the next press still runs', async () => {
    const { call } = setup({ importVrcx: () => Promise.reject(new Error('boom')) })
    await expect(call('import-vrcx-history')).resolves.toEqual({ ok: false, reason: 'failed' })
    await expect(call('backup-history')).resolves.toEqual({ ok: true })
  })
})
