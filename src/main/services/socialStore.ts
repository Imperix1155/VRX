import Store from 'electron-store'
import { z } from 'zod'
import type { AccountScoped, Platform } from '@shared/types'
import { AccountSession, accountKey, isPlatformAccountId } from './accountSession'

export const SOCIAL_STORE_FORMAT_VERSION = 1
export const SOCIAL_NAMESPACE_SCHEMA_VERSION = 1
export const FAVORITES_MAX = 5_000
export const NOTES_MAX = 5_000
export const TAGGED_FRIENDS_MAX = 5_000
export const TAGS_PER_FRIEND_MAX = 25
export const PER_FRIEND_OPT_OUTS_MAX = 5_000
export const HISTORY_RING_CAPACITY = 200

const FRIEND_ID_PATTERN = /^[A-Za-z0-9_-]+$/
const platformAccountIdSchema = z.string().refine(isPlatformAccountId)
const friendIdSchema = z.string().min(1).max(256).regex(FRIEND_ID_PATTERN)

function cappedRecordSchema<T extends z.ZodType>(valueSchema: T, maximum: number): z.ZodType {
  return z.record(friendIdSchema, valueSchema).superRefine((value, context) => {
    if (Object.keys(value).length > maximum) {
      context.addIssue({ code: 'custom', message: `must contain at most ${maximum} entries` })
    }
  })
}

const favoritesSchema = cappedRecordSchema(z.literal(true), FAVORITES_MAX)
const notesSchema = cappedRecordSchema(z.string().max(10_000), NOTES_MAX)
const tagsSchema = cappedRecordSchema(
  z.array(z.string().min(1).max(64)).max(TAGS_PER_FRIEND_MAX),
  TAGGED_FRIENDS_MAX
)
const socialPrefsSchema = z
  .object({
    notifyFriendOnline: z.boolean().optional(),
    notifyFriendInGame: z.boolean().optional(),
    notifyFriendOffline: z.boolean().optional(),
    notifyHotInstance: z.boolean().optional(),
    followedFriendIds: z.array(friendIdSchema).max(FAVORITES_MAX).optional()
  })
  .strict()
const alertTypeSchema = z.enum(['online', 'in-game', 'offline', 'hot-instance'])
const perFriendOptOutsSchema = cappedRecordSchema(
  z.array(alertTypeSchema).max(alertTypeSchema.options.length),
  PER_FRIEND_OPT_OUTS_MAX
)

export type FavoritesData = Record<string, true>
export type NotesData = Record<string, string>
export type TagsData = Record<string, string[]>
export interface SocialPrefsData {
  notifyFriendOnline?: boolean
  notifyFriendInGame?: boolean
  notifyFriendOffline?: boolean
  notifyHotInstance?: boolean
  followedFriendIds?: string[]
}
export type PerFriendOptOutsData = Record<
  string,
  Array<'online' | 'in-game' | 'offline' | 'hot-instance'>
>

export interface BoundedHistoryRing<T> {
  capacity: typeof HISTORY_RING_CAPACITY
  entries: T[]
}

export interface SocialNamespaceDataMap {
  favorites: FavoritesData
  notes: NotesData
  tags: TagsData
  socialPrefs: SocialPrefsData
  perFriendOptOuts: PerFriendOptOutsData
  instanceHistory: BoundedHistoryRing<Record<string, unknown>>
  activityHistory: BoundedHistoryRing<Record<string, unknown>>
}

export type SocialNamespace = keyof SocialNamespaceDataMap
export type SmallSocialNamespace = Exclude<SocialNamespace, 'instanceHistory' | 'activityHistory'>

export interface AccountWriteContext {
  platform: Platform
  platformAccountId: string
  epoch: number
}

export interface SocialStoreFile {
  storeFormatVersion: number
  accounts: Record<string, unknown>
}

export interface SocialStoreStorage {
  read(): unknown
  write(value: SocialStoreFile): void
}

const namespaceSchemas: Record<SmallSocialNamespace, z.ZodType> = {
  favorites: favoritesSchema,
  notes: notesSchema,
  tags: tagsSchema,
  socialPrefs: socialPrefsSchema,
  perFriendOptOuts: perFriendOptOutsSchema
}

const rootSchema = z
  .object({
    storeFormatVersion: z.number().int().nonnegative(),
    accounts: z.record(z.string(), z.unknown())
  })
  .passthrough()
const formatVersionSchema = z
  .object({ storeFormatVersion: z.number().int().nonnegative() })
  .passthrough()

class ElectronSocialStoreStorage implements SocialStoreStorage {
  private store: Store<Record<string, unknown>> | null = null

  read(): unknown {
    return this.getStore().store
  }

  write(value: SocialStoreFile): void {
    this.getStore().store = { ...value }
  }

  private getStore(): Store<Record<string, unknown>> {
    this.store ??= new Store<Record<string, unknown>>({
      name: 'social',
      accessPropertiesByDotNotation: false
    })
    return this.store
  }
}

interface SocialStoreLoadResult {
  file: SocialStoreFile
  loadValid: boolean
}

function emptySocialStoreFile(storeFormatVersion = SOCIAL_STORE_FORMAT_VERSION): SocialStoreFile {
  return { storeFormatVersion, accounts: {} }
}

function serializedFormatVersion(raw: string): number | null {
  const match = /["']storeFormatVersion["']\s*:\s*(\d+)/.exec(raw)
  if (!match) return null
  const version = Number(match[1])
  return Number.isSafeInteger(version) ? version : null
}

function parseRoot(raw: unknown): SocialStoreLoadResult {
  if (isRecord(raw) && Object.keys(raw).length === 0) {
    return { file: emptySocialStoreFile(), loadValid: true }
  }

  let candidate = raw
  if (typeof raw === 'string') {
    try {
      candidate = JSON.parse(raw) as unknown
    } catch {
      return {
        file: emptySocialStoreFile(serializedFormatVersion(raw) ?? SOCIAL_STORE_FORMAT_VERSION),
        loadValid: false
      }
    }
  }

  const parsed = rootSchema.safeParse(candidate)
  if (!parsed.success) {
    const formatVersion = formatVersionSchema.safeParse(candidate)
    return {
      file: emptySocialStoreFile(
        formatVersion.success ? formatVersion.data.storeFormatVersion : SOCIAL_STORE_FORMAT_VERSION
      ),
      loadValid: false
    }
  }
  return {
    file: {
      storeFormatVersion: parsed.data.storeFormatVersion,
      accounts: parsed.data.accounts
    },
    loadValid: true
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requirePlatformAccountId(platformAccountId: string): void {
  if (!isPlatformAccountId(platformAccountId)) {
    throw new Error('social store: invalid platform account id')
  }
}

/** Versioned, bounded persistence for small account-scoped social overlays. */
export class SocialStore {
  private readonly storage: SocialStoreStorage
  private file: SocialStoreFile
  private readonly loadValid: boolean

  constructor(
    private readonly accountSession: AccountSession,
    storage?: SocialStoreStorage
  ) {
    this.storage = storage ?? new ElectronSocialStoreStorage()
    try {
      const loaded = parseRoot(this.storage.read())
      this.file = loaded.file
      this.loadValid = loaded.loadValid
    } catch {
      this.file = emptySocialStoreFile()
      this.loadValid = false
    }
  }

  read<N extends SmallSocialNamespace>(
    platform: Platform,
    platformAccountId: string,
    namespace: N
  ): AccountScoped<SocialNamespaceDataMap[N]> | null {
    requirePlatformAccountId(platformAccountId)
    const key = accountKey(platform, platformAccountId)
    const account = this.file.accounts[key]
    if (!isRecord(account)) return null

    const envelopeSchema = z.object({
      schemaVersion: z.literal(SOCIAL_NAMESPACE_SCHEMA_VERSION),
      platform: z.enum(['vrchat', 'chilloutvr']),
      platformAccountId: platformAccountIdSchema,
      data: namespaceSchemas[namespace]
    })
    const parsed = envelopeSchema.safeParse(account[namespace])
    if (
      !parsed.success ||
      parsed.data.platform !== platform ||
      parsed.data.platformAccountId !== platformAccountId
    ) {
      return null
    }
    return structuredClone(parsed.data) as AccountScoped<SocialNamespaceDataMap[N]>
  }

  write<N extends SocialNamespace>(
    context: AccountWriteContext,
    namespace: N,
    data: SocialNamespaceDataMap[N]
  ): AccountScoped<SocialNamespaceDataMap[N]> {
    requirePlatformAccountId(context.platformAccountId)
    const key = accountKey(context.platform, context.platformAccountId)
    const resolution = this.accountSession.resolve(context.platform)
    if (
      'status' in resolution ||
      resolution.accountKey !== key ||
      resolution.epoch !== context.epoch
    ) {
      throw new Error('social store: stale account epoch')
    }
    if (namespace === 'instanceHistory' || namespace === 'activityHistory') {
      throw new Error('social store: history writes are not supported in this milestone')
    }
    if (this.file.storeFormatVersion > SOCIAL_STORE_FORMAT_VERSION) {
      throw new Error('social store: refusing to overwrite social data written by a newer version')
    }
    if (!this.loadValid) {
      throw new Error('social store: storage could not be loaded; explicit recovery/reset required')
    }

    const smallNamespace: SmallSocialNamespace = namespace
    const parsed = namespaceSchemas[smallNamespace].safeParse(data)
    if (!parsed.success) throw new Error(`social store: invalid ${namespace} data`)

    const envelope = {
      schemaVersion: SOCIAL_NAMESPACE_SCHEMA_VERSION,
      platform: context.platform,
      platformAccountId: context.platformAccountId,
      data: parsed.data
    } as AccountScoped<SocialNamespaceDataMap[N]>
    const existing = this.file.accounts[key]
    const account = isRecord(existing) ? { ...existing } : {}
    account[smallNamespace] = envelope
    this.file = {
      storeFormatVersion: SOCIAL_STORE_FORMAT_VERSION,
      accounts: { ...this.file.accounts, [key]: account }
    }
    this.storage.write(structuredClone(this.file))
    return structuredClone(envelope)
  }
}
