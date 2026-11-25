import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import type { AutoBackupFolderResult, AutoBackupStatus } from '@shared/autoBackup'

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

import { registerAutoBackupHandlers, type AutoBackupHandlerOptions } from './auto-backup'

const event = { senderFrame: {} } as unknown as IpcMainInvokeEvent
const idle: AutoBackupStatus = {
  usingDefaultFolder: true,
  folderName: 'backups',
  lastBackupAt: null,
  lastError: null,
  copies: []
}

function setup(overrides: Partial<AutoBackupHandlerOptions> = {}): AutoBackupHandlerOptions {
  const options: AutoBackupHandlerOptions = {
    status: vi.fn(() => Promise.resolve(idle)),
    pickFolder: vi.fn(() => Promise.resolve('/picked/backups')),
    setDirectory: vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        usingDefaultFolder: true,
        folderName: 'backups'
      })
    ),
    restore: vi.fn(() => Promise.resolve({ ok: true as const })),
    ...overrides
  }
  registerAutoBackupHandlers(options)
  return options
}

beforeEach(() => {
  handlers.clear()
  trusted.value = true
})

describe('scheduled backup handlers', () => {
  it('refuses an untrusted sender on every channel', () => {
    setup()
    trusted.value = false
    for (const channel of [
      'get-auto-backup',
      'choose-auto-backup-folder',
      'reset-auto-backup-folder',
      'restore-auto-backup'
    ]) {
      expect(() =>
        handlers.get(channel)?.(event, { id: 'vrx-backup-20261125T053301123Z' })
      ).toThrow('Untrusted IPC sender')
    }
  })

  it('does not change the folder when the dialog is cancelled', async () => {
    const options = setup({ pickFolder: vi.fn(() => Promise.resolve(null)) })
    await expect(handlers.get('choose-auto-backup-folder')?.(event)).resolves.toEqual({
      ok: false,
      reason: 'cancelled'
    })
    expect(options.setDirectory).not.toHaveBeenCalled()
  })

  it('reports a folder reset that did not stick', async () => {
    const failed: AutoBackupFolderResult = { ok: false, reason: 'failed' }
    setup({ setDirectory: vi.fn(() => Promise.resolve(failed)) })
    await expect(handlers.get('reset-auto-backup-folder')?.(event)).resolves.toEqual(failed)
  })

  it('refuses a restore id that is not a backup name', async () => {
    const options = setup()
    await expect(
      handlers.get('restore-auto-backup')?.(event, { id: '../credentials.json' })
    ).resolves.toEqual({
      ok: false,
      reason: 'unknown'
    })
    await expect(
      handlers.get('restore-auto-backup')?.(event, {
        id: 'vrx-backup-20261125T053301123Z',
        extra: true
      })
    ).resolves.toEqual({ ok: false, reason: 'unknown' })
    await expect(
      handlers.get('restore-auto-backup')?.(event, 'vrx-backup-20261125T053301123Z')
    ).resolves.toEqual({
      ok: false,
      reason: 'unknown'
    })
    expect(options.restore).not.toHaveBeenCalled()
  })

  it('restores the named copy and nothing else', async () => {
    const options = setup()
    const id = 'vrx-backup-20261125T053301123Z'
    await expect(handlers.get('restore-auto-backup')?.(event, { id })).resolves.toEqual({
      ok: true
    })
    expect(options.restore).toHaveBeenCalledExactlyOnceWith(id)
  })
})
