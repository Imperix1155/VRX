import { ipcMain } from 'electron'
import type { IpcInvoke } from '@shared/ipc'
import type { Platform } from '@shared/types'
import type { AccountSession } from '../services/accountSession'
import type { NotesData, SocialStore } from '../services/socialStore'
import { isTrustedIpcSender } from './security'

const VALID_PLATFORMS = new Set<Platform>(['vrchat', 'chilloutvr'])
const MAX_NOTE_LENGTH = 500

export interface NotesHandlerOptions {
  accountSession: AccountSession
  socialStore: SocialStore
}

export function registerNotesHandlers(options: NotesHandlerOptions): void {
  ipcMain.handle('get-friend-note', (event, req: IpcInvoke['get-friend-note']['req']) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    if (!req || !VALID_PLATFORMS.has(req.platform) || typeof req.friendId !== 'string') {
      throw new Error('Invalid get-friend-note request')
    }

    const resolution = options.accountSession.resolve(req.platform)
    if ('status' in resolution) return { note: null }

    const platformAccountId = options.accountSession.getAccountId(req.platform)
    if (platformAccountId === null) return { note: null }

    const envelope = options.socialStore.read(req.platform, platformAccountId, 'notes')
    return { note: envelope?.data[req.friendId] ?? null }
  })

  ipcMain.handle('set-friend-note', (event, req: IpcInvoke['set-friend-note']['req']) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    if (!req || !VALID_PLATFORMS.has(req.platform)) {
      throw new Error('Invalid set-friend-note request')
    }

    const resolution = options.accountSession.resolve(req.platform)
    if ('status' in resolution) return { ok: false, reason: 'not-authenticated' as const }

    const platformAccountId = options.accountSession.getAccountId(req.platform)
    if (platformAccountId === null) return { ok: false, reason: 'not-authenticated' as const }

    if (
      typeof req.friendId !== 'string' ||
      req.friendId.length === 0 ||
      typeof req.note !== 'string' ||
      req.note.trimEnd().length > MAX_NOTE_LENGTH
    ) {
      return { ok: false, reason: 'invalid' as const }
    }

    const envelope = options.socialStore.read(req.platform, platformAccountId, 'notes')
    const notes: NotesData = { ...(envelope?.data ?? {}) }
    const trimmed = req.note.trimEnd()
    if (trimmed.length === 0) {
      delete notes[req.friendId]
    } else {
      notes[req.friendId] = trimmed
    }

    try {
      options.socialStore.write(
        {
          platform: req.platform,
          platformAccountId,
          epoch: resolution.epoch
        },
        'notes',
        notes
      )
      return { ok: true as const }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('stale account epoch')) {
        return { ok: false, reason: 'stale' as const }
      }
      throw error
    }
  })
}
