import {
  ACCOUNT_NOTE_CHECK_REUSE_MS,
  ACCOUNT_NOTE_WRITE_SPACING_MS,
  accountNoteToSend,
  comparableNote,
  decideAccountNote,
  fitsAccountNote,
  readableAccountNote,
  type AccountNoteSyncFailure,
  type AccountNoteSyncMode,
  type AccountNoteSyncResult
} from '@shared/accountNotes'
import type { Platform } from '@shared/types'
import type { AccountNoteAdapter } from './adapters/AccountNoteAdapter'
import { CommunityDataError } from './adapters/CommunityAdapter'
import {
  AuthError,
  RateLimitError,
  RequestCancelledError,
  RequestQueueFullError
} from './adapters/errors'
import type { RequestLease } from './adapters/RequestLease'
import type { AccountSession } from './accountSession'
import type { NoteSyncData, NotesData, SocialStore } from './socialStore'

type AccountNoteLog = (
  message: 'account note request failed',
  meta: { platform: Platform; kind: 'read' | 'write'; reason: AccountNoteSyncFailure }
) => void

export interface AccountNoteRequest {
  platform: Platform
  friendId: string
  revision: { platformAccountId: string; epoch: number }
  mode: AccountNoteSyncMode
}

export interface AccountNoteServiceOptions {
  adapters: ReadonlyMap<Platform, AccountNoteAdapter>
  socialStore: Pick<SocialStore, 'read' | 'write'>
  accountSession: Pick<AccountSession, 'resolve' | 'getAccountId'>
  /** Whether the person is on the signed-in user's friends list now. */
  isFriend: (platform: Platform, userId: string) => boolean
  /** Settings → Save notes to my accounts. */
  isEnabled: () => boolean
  clock?: () => number
  sleep?: (ms: number) => Promise<void>
  log?: AccountNoteLog
}

interface SeenAccountNote {
  generation: number
  /** The account copy as the platform sent it. */
  note: string
  at: number
}

/** Bounds what one session remembers about account copies. */
const MAX_SEEN = 500

/**
 * Keeps VRX's friend notes and the copies on the user's own accounts in step.
 * Nothing runs on a timer: a check follows a drawer opening, a save follows a
 * note edit, and keep-mine or use-account follows the user's choice. One call
 * per friend runs at a time, writes on a platform are spaced
 * ACCOUNT_NOTE_WRITE_SPACING_MS apart, and no request is sent twice on its own.
 * VRX never overwrites an account copy it has not just read, so a note changed
 * in the game or on the website is never silently replaced.
 */
export class AccountNoteService {
  private readonly clock: () => number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly log: AccountNoteLog
  private readonly running = new Map<string, Promise<unknown>>()
  private readonly writes = new Map<Platform, Promise<unknown>>()
  private readonly lastWriteAt = new Map<Platform, number>()
  private readonly seen = new Map<string, SeenAccountNote>()

  constructor(private readonly options: AccountNoteServiceOptions) {
    this.clock = options.clock ?? (() => performance.now())
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
    this.log = options.log ?? (() => undefined)
  }

  sync(request: AccountNoteRequest): Promise<AccountNoteSyncResult> {
    const key = `${request.platform}:${request.revision.platformAccountId}:${request.friendId}`
    const previous = this.running.get(key) ?? Promise.resolve()
    const next = previous.then(
      () => this.run(request, key),
      () => this.run(request, key)
    )
    const settled = next.catch(() => undefined)
    this.running.set(key, settled)
    void settled.then(() => {
      if (this.running.get(key) === settled) this.running.delete(key)
    })
    return next
  }

  /** Forget what VRX saw on a platform's account at a sign-out or account change. */
  clearPlatform(platform: Platform): void {
    for (const key of this.seen.keys()) if (key.startsWith(`${platform}:`)) this.seen.delete(key)
  }

  private async run(request: AccountNoteRequest, key: string): Promise<AccountNoteSyncResult> {
    const { platform, friendId, mode } = request
    const epoch = this.currentEpoch(request)
    if (epoch === null) return { ok: false, reason: 'stale' }
    const platformAccountId = request.revision.platformAccountId
    const local = this.localNote(platform, platformAccountId, friendId)
    if (!this.options.isEnabled()) return { ok: true, state: 'off', note: local }
    if (!this.options.isFriend(platform, friendId)) return { ok: false, reason: 'not-friend' }

    const adapter = this.options.adapters.get(platform)
    if (!adapter) return { ok: false, reason: 'not-authenticated' }
    let lease: RequestLease
    try {
      lease = adapter.captureNoteLease()
    } catch {
      return { ok: false, reason: 'not-authenticated' }
    }

    const context = { platform, platformAccountId, epoch }
    const seen = this.seen.get(key)
    const seenNow = seen !== undefined && seen.generation === lease.generation ? seen : undefined

    if (mode === 'use-account') {
      // The user (or the drawer, when only the account changed) takes the copy
      // VRX showed them. Without one there is nothing safe to take: check again.
      if (seenNow === undefined) return this.run({ ...request, mode: 'check' }, key)
      const note = readableAccountNote(platform, seenNow.note)
      return this.storeLocally(context, friendId, note)
    }

    let account: string
    if (
      mode === 'check' &&
      seenNow !== undefined &&
      this.clock() - seenNow.at < ACCOUNT_NOTE_CHECK_REUSE_MS
    ) {
      account = seenNow.note
    } else {
      const read = await this.readAccount(adapter, friendId, lease)
      if (!read.ok) return read
      account = read.note
      this.remember(key, { generation: lease.generation, note: account, at: this.clock() })
    }

    const agreed = this.agreedNote(platform, platformAccountId, friendId)
    const localForm = comparableNote(platform, local)
    const accountForm = comparableNote(platform, account)
    let decision = decideAccountNote(localForm, accountForm, agreed)

    if (mode === 'keep-mine') {
      if (seenNow === undefined) return { ok: false, reason: 'stale' }
      // Keep mine replaces only the account copy the user was shown.
      if (comparableNote(platform, seenNow.note) !== accountForm) {
        return {
          ok: true,
          state: 'conflict',
          note: local,
          accountNote: readableAccountNote(platform, account)
        }
      }
      if (decision !== 'in-sync') decision = 'send-local'
    }

    switch (decision) {
      case 'in-sync':
        return this.storeAgreed(context, friendId, localForm, local)
      case 'take-account':
      case 'conflict':
        return {
          ok: true,
          state: decision === 'take-account' ? 'account-changed' : 'conflict',
          note: local,
          accountNote: readableAccountNote(platform, account)
        }
      case 'send-local': {
        if (!fitsAccountNote(platform, local)) return { ok: true, state: 'too-long', note: local }
        if (mode === 'check') return { ok: true, state: 'local-only', note: local }
        const sent = accountNoteToSend(platform, local)
        const written = await this.writeAccount(adapter, friendId, sent, lease)
        if (!written.ok) return written
        this.remember(key, { generation: lease.generation, note: sent, at: this.clock() })
        return this.storeAgreed(context, friendId, localForm, local)
      }
    }
  }

  private currentEpoch(request: AccountNoteRequest): number | null {
    const resolution = this.options.accountSession.resolve(request.platform)
    if ('status' in resolution) return null
    if (
      this.options.accountSession.getAccountId(request.platform) !==
      request.revision.platformAccountId
    )
      return null
    if (resolution.epoch !== request.revision.epoch) return null
    return resolution.epoch
  }

  private localNote(platform: Platform, platformAccountId: string, friendId: string): string {
    const notes = this.options.socialStore.read(platform, platformAccountId, 'notes')?.data
    return notes !== undefined && Object.hasOwn(notes, friendId) ? (notes[friendId] ?? '') : ''
  }

  private agreedNote(
    platform: Platform,
    platformAccountId: string,
    friendId: string
  ): string | undefined {
    const agreed = this.options.socialStore.read(platform, platformAccountId, 'noteSync')?.data
    return agreed !== undefined && Object.hasOwn(agreed, friendId) ? agreed[friendId] : undefined
  }

  private storeAgreed(
    context: { platform: Platform; platformAccountId: string; epoch: number },
    friendId: string,
    agreed: string,
    local: string
  ): AccountNoteSyncResult {
    const { platform, platformAccountId } = context
    if (this.agreedNote(platform, platformAccountId, friendId) === agreed) {
      return { ok: true, state: 'saved', note: local }
    }
    const envelope = this.options.socialStore.read(platform, platformAccountId, 'noteSync')
    const data = Object.assign(Object.create(null), envelope?.data ?? {}) as NoteSyncData
    data[friendId] = agreed
    try {
      this.options.socialStore.write(context, 'noteSync', { ...data })
    } catch {
      return { ok: false, reason: 'stale' }
    }
    return { ok: true, state: 'saved', note: local }
  }

  private storeLocally(
    context: { platform: Platform; platformAccountId: string; epoch: number },
    friendId: string,
    note: string
  ): AccountNoteSyncResult {
    const { platform, platformAccountId } = context
    const envelope = this.options.socialStore.read(platform, platformAccountId, 'notes')
    const notes = Object.assign(Object.create(null), envelope?.data ?? {}) as NotesData
    const trimmed = note.trimEnd()
    if (trimmed.length === 0) delete notes[friendId]
    else notes[friendId] = trimmed
    try {
      this.options.socialStore.write(context, 'notes', { ...notes })
    } catch {
      return { ok: false, reason: 'stale' }
    }
    return this.storeAgreed(context, friendId, comparableNote(platform, trimmed), trimmed)
  }

  private async readAccount(
    adapter: AccountNoteAdapter,
    friendId: string,
    lease: RequestLease
  ): Promise<{ ok: true; note: string } | { ok: false; reason: AccountNoteSyncFailure }> {
    try {
      const note = await adapter.readAccountNote(friendId, lease)
      // A reply that does not say is not an empty note: refuse rather than guess.
      if (note === null) return this.failure(adapter.platform, 'read', 'unavailable')
      return { ok: true, note }
    } catch (error) {
      return this.failure(adapter.platform, 'read', this.reason(error))
    }
  }

  private async writeAccount(
    adapter: AccountNoteAdapter,
    friendId: string,
    note: string,
    lease: RequestLease
  ): Promise<{ ok: true } | { ok: false; reason: AccountNoteSyncFailure }> {
    const platform = adapter.platform
    const previous = this.writes.get(platform) ?? Promise.resolve()
    const run = previous.then(async () => {
      const last = this.lastWriteAt.get(platform)
      const wait = last === undefined ? 0 : last + ACCOUNT_NOTE_WRITE_SPACING_MS - this.clock()
      if (wait > 0) await this.sleep(wait)
      if (!lease.isCurrent() || lease.signal.aborted) throw new RequestCancelledError()
      try {
        await adapter.writeAccountNote(friendId, note, lease)
      } finally {
        this.lastWriteAt.set(platform, this.clock())
      }
    })
    this.writes.set(
      platform,
      run.catch(() => undefined)
    )
    try {
      await run
      return { ok: true }
    } catch (error) {
      return this.failure(platform, 'write', this.reason(error))
    }
  }

  private remember(key: string, value: SeenAccountNote): void {
    this.seen.delete(key)
    this.seen.set(key, value)
    while (this.seen.size > MAX_SEEN) this.seen.delete(this.seen.keys().next().value!)
  }

  private reason(error: unknown): AccountNoteSyncFailure {
    if (error instanceof RequestCancelledError) return 'stale'
    if (error instanceof AuthError) return 'not-authenticated'
    if (error instanceof RateLimitError || error instanceof RequestQueueFullError)
      return 'rate-limited'
    if (error instanceof CommunityDataError) return 'invalid'
    return 'unavailable'
  }

  private failure(
    platform: Platform,
    kind: 'read' | 'write',
    reason: AccountNoteSyncFailure
  ): { ok: false; reason: AccountNoteSyncFailure } {
    this.log('account note request failed', { platform, kind, reason })
    return { ok: false, reason }
  }
}
