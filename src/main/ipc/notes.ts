import { ipcMain } from 'electron'
import type { IpcInvoke } from '@shared/ipc'
import type { Platform } from '@shared/types'
import type { AccountSession } from '../services/accountSession'
import type { NotesData, SocialStore } from '../services/socialStore'
import { isTrustedIpcSender } from './security'

const VALID_PLATFORMS = new Set<Platform>(['vrchat', 'chilloutvr'])
const MAX_NOTE_LENGTH = 500
const MAX_FRIEND_ID_LENGTH = 128
const FRIEND_ID_PATTERN = /^[A-Za-z0-9_-]+$/

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

export interface NotesHandlerOptions {
  accountSession: AccountSession
  socialStore: SocialStore
}

function isValidFriendId(friendId: unknown): friendId is string {
  if (typeof friendId !== 'string') return false
  if (friendId.length === 0 || friendId.length > MAX_FRIEND_ID_LENGTH) return false
  if (FORBIDDEN_KEYS.has(friendId)) return false
  return FRIEND_ID_PATTERN.test(friendId)
}

function revisionFor(
  platform: Platform,
  accountSession: AccountSession
): { platformAccountId: string; epoch: number } | undefined {
  const resolution = accountSession.resolve(platform)
  if ('status' in resolution) return undefined
  const platformAccountId = accountSession.getAccountId(platform)
  if (platformAccountId === null) return undefined
  return { platformAccountId, epoch: resolution.epoch }
}

export function registerNotesHandlers(options: NotesHandlerOptions): void {
  ipcMain.handle('get-friend-note', (event, req: IpcInvoke['get-friend-note']['req']) => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    if (!req || !VALID_PLATFORMS.has(req.platform)) {
      throw new Error('Invalid get-friend-note request')
    }

    if (!isValidFriendId(req.friendId)) {
      return { note: null }
    }

    const revision = revisionFor(req.platform, options.accountSession)
    if (revision === undefined) {
      return { note: null }
    }

    const envelope = options.socialStore.read(req.platform, revision.platformAccountId, 'notes')
    const notes = Object.assign(Object.create(null), envelope?.data ?? {}) as NotesData
    const note = Object.hasOwn(notes, req.friendId) ? notes[req.friendId] : null
    return { note, revision }
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
      !isValidFriendId(req.friendId) ||
      typeof req.note !== 'string' ||
      req.note.trimEnd().length > MAX_NOTE_LENGTH
    ) {
      return { ok: false, reason: 'invalid' as const }
    }

    if (
      !req.revision ||
      req.revision.platformAccountId !== platformAccountId ||
      req.revision.epoch !== resolution.epoch
    ) {
      return { ok: false, reason: 'stale' as const }
    }

    const envelope = options.socialStore.read(req.platform, platformAccountId, 'notes')
    const notes = Object.assign(Object.create(null), envelope?.data ?? {}) as NotesData
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
      // Any remaining SocialStore throw is a validation/serialization problem.
      return { ok: false, reason: 'invalid' as const }
    }
  })
}
