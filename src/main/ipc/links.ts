import { ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type {
  LinkChange,
  LinkProfileSnapshot,
  LinkedProfile,
  LinkRequest,
  LinkResult,
  LinkSnapshot
} from '@shared/linkedProfiles'
import type { Platform } from '@shared/types'
import type { AccountSession } from '../services/accountSession'
import type { LinkGraphStore } from '../services/linkGraphStore'
import { isTrustedIpcSender } from './security'

export interface LinksHandlerOptions {
  accountSession: AccountSession
  linkGraph: LinkGraphStore
  onChanged?: () => void
}

const platform = z.enum(['vrchat', 'chilloutvr'])
const id = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9_-]+$/)
  .refine((value) => !['__proto__', 'constructor', 'prototype'].includes(value))
const revision = z
  .number()
  .int()
  .min(1)
  .max(Number.MAX_SAFE_INTEGER - 1)
const friendRef = z.object({ platform, friendId: id }).strict()
const requestSchema = z
  .object({
    lease: z.string().min(1).max(128),
    change: z.discriminatedUnion('kind', [
      z
        .object({
          kind: z.literal('replace'),
          members: z.tuple([friendRef, friendRef]),
          preferredPlatform: platform,
          defaultName: z.string().max(256),
          expectedPeople: z.array(z.object({ id: id.max(128), revision }).strict()).max(2)
        })
        .strict(),
      z
        .object({ kind: z.literal('unlink'), personId: id.max(128), expectedRevision: revision })
        .strict(),
      z
        .object({
          kind: z.literal('update'),
          personId: id.max(128),
          expectedRevision: revision,
          patch: z
            .object({
              customName: z.string().trim().min(1).max(256).nullable(),
              defaultName: z.string().max(256),
              preferredPlatform: platform,
              pictureMode: z.enum(['preferred', 'merged']),
              sharedNote: z
                .string()
                .transform((note) => note.trimEnd())
                .pipe(z.string().max(500))
            })
            .partial()
            .strict()
        })
        .strict()
    ])
  })
  .strict()

export function registerLinksHandlers(options: LinksHandlerOptions): void {
  const { accountSession, linkGraph } = options
  let lease = ''
  let sessionKey = ''
  const currentKey = (): string =>
    JSON.stringify((['vrchat', 'chilloutvr'] as const).map((p) => accountSession.resolve(p)))
  const currentLease = (): string => {
    const key = currentKey()
    if (key !== sessionKey || !lease) {
      sessionKey = key
      lease = randomUUID()
    }
    return lease
  }
  const isAnchored = (person: LinkedProfile): boolean =>
    person.members.some((member) => {
      const state = accountSession.resolve(member.platform)
      return (
        !('status' in state) &&
        accountSession.getAccountId(member.platform) === member.platformAccountId
      )
    })
  const snapshot = (): LinkResult<LinkSnapshot> => {
    try {
      const current = linkGraph.snapshot()
      return {
        ok: true,
        value: { ...current, profiles: current.profiles.filter(isAnchored), lease: currentLease() }
      }
    } catch {
      return { ok: false, reason: 'storage' }
    }
  }

  ipcMain.handle('get-linked-profiles', (event): LinkResult<LinkSnapshot> => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    return snapshot()
  })
  ipcMain.handle('change-linked-profile', (event, request: unknown): LinkResult<LinkSnapshot> => {
    if (!isTrustedIpcSender(event.senderFrame)) throw new Error('Untrusted IPC sender')
    const parsed = requestSchema.safeParse(request)
    if (!parsed.success) return { ok: false, reason: 'invalid' }
    if (parsed.data.lease !== currentLease()) return { ok: false, reason: 'stale' }
    const change: LinkRequest = parsed.data.change
    let qualified: LinkChange
    if (change.kind === 'replace') {
      if (change.members[0].platform === change.members[1].platform)
        return { ok: false, reason: 'invalid' }
      const scopes = new Map<Platform, string>()
      for (const member of change.members) {
        const resolution = accountSession.resolve(member.platform)
        const accountId = accountSession.getAccountId(member.platform)
        if ('status' in resolution || !accountId) return { ok: false, reason: 'unavailable' }
        scopes.set(member.platform, accountId)
      }
      qualified = {
        ...change,
        members: [
          { ...change.members[0], platformAccountId: scopes.get(change.members[0].platform)! },
          { ...change.members[1], platformAccountId: scopes.get(change.members[1].platform)! }
        ]
      }
    } else {
      const visible = snapshot()
      if (!visible.ok) return visible
      if (!visible.value.profiles.some((person) => person.id === change.personId))
        return { ok: false, reason: 'unavailable' }
      qualified = change
    }
    let committed: LinkProfileSnapshot
    try {
      committed = linkGraph.apply(qualified, true)
    } catch (error) {
      if (error instanceof z.ZodError) return { ok: false, reason: 'invalid' }
      if (error instanceof Error && error.message === 'link graph: stale confirmation')
        return { ok: false, reason: 'stale' }
      return { ok: false, reason: 'storage' }
    }
    // The committed write owns the result. A notification failure must not ask
    // the caller to replay a destructive command that already succeeded.
    const result: LinkResult<LinkSnapshot> = {
      ok: true,
      value: {
        ...committed,
        profiles: committed.profiles.filter(isAnchored),
        lease: currentLease()
      }
    }
    try {
      options.onChanged?.()
    } catch {
      /* Other consumers reload on next read. */
    }
    return result
  })
}
