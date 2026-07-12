import Store from 'electron-store'
import { z } from 'zod'
import type { Account, Platform } from '@shared/types'
import { AccountSession, accountKey, isPlatformAccountId } from './accountSession'

export const ACCOUNT_REGISTRY_FORMAT_VERSION = 1

export type AccountRegistryState = 'active' | 'known' | 'removed'

export interface AccountRegistryEntry {
  platform: Platform
  platformAccountId: string
  displayName: string
  state: AccountRegistryState
}

export interface AccountRegistryFile {
  storeFormatVersion: number
  entries: Record<string, AccountRegistryEntry>
}

export interface AccountRegistryStorage {
  read(): unknown
  write(value: AccountRegistryFile): void
}

const entrySchema = z.object({
  platform: z.enum(['vrchat', 'chilloutvr']),
  platformAccountId: z.string().refine(isPlatformAccountId),
  displayName: z.string(),
  state: z.enum(['active', 'known', 'removed'])
})

const fileSchema = z.object({
  storeFormatVersion: z.number().int().nonnegative(),
  entries: z.record(z.string(), entrySchema)
})

const formatVersionSchema = z
  .object({ storeFormatVersion: z.number().int().nonnegative() })
  .passthrough()

class ElectronAccountRegistryStorage implements AccountRegistryStorage {
  private readonly store = new Store<Record<string, unknown>>({
    name: 'accounts',
    accessPropertiesByDotNotation: false
  })

  read(): unknown {
    return this.store.store
  }

  write(value: AccountRegistryFile): void {
    this.store.store = { ...value }
  }
}

function parseRegistryFile(raw: unknown): AccountRegistryFile {
  const formatVersion = formatVersionSchema.safeParse(raw)
  if (
    formatVersion.success &&
    formatVersion.data.storeFormatVersion > ACCOUNT_REGISTRY_FORMAT_VERSION
  ) {
    return { storeFormatVersion: formatVersion.data.storeFormatVersion, entries: {} }
  }

  const parsed = fileSchema.safeParse(raw)
  if (!parsed.success) {
    return { storeFormatVersion: ACCOUNT_REGISTRY_FORMAT_VERSION, entries: {} }
  }

  const entries: Record<string, AccountRegistryEntry> = {}
  for (const [key, entry] of Object.entries(parsed.data.entries)) {
    if (key === accountKey(entry.platform, entry.platformAccountId)) entries[key] = entry
  }
  return { storeFormatVersion: parsed.data.storeFormatVersion, entries }
}

/** Durable source of truth for known accounts; only remove() creates tombstones. */
export class AccountRegistry {
  private readonly storage: AccountRegistryStorage
  private file: AccountRegistryFile

  constructor(
    private readonly accountSession: AccountSession,
    storage?: AccountRegistryStorage
  ) {
    this.storage = storage ?? new ElectronAccountRegistryStorage()
    try {
      this.file = parseRegistryFile(this.storage.read())
    } catch {
      this.file = { storeFormatVersion: ACCOUNT_REGISTRY_FORMAT_VERSION, entries: {} }
    }
  }

  recordAuthenticated(
    platform: Platform,
    platformAccountId: string,
    epoch: number,
    displayName: string
  ): void {
    const key = accountKey(platform, platformAccountId)
    const resolution = this.accountSession.resolve(platform)
    if ('status' in resolution || resolution.accountKey !== key || resolution.epoch !== epoch) {
      throw new Error('account registry: stale authenticated identity')
    }
    this.assertWritable()

    const entries = structuredClone(this.file.entries)
    for (const entry of Object.values(entries)) {
      if (entry.platform === platform && entry.state === 'active') entry.state = 'known'
    }

    entries[key] = {
      platform,
      platformAccountId,
      displayName,
      state: 'active'
    }
    if (JSON.stringify(entries) === JSON.stringify(this.file.entries)) return
    this.file.entries = entries
    this.persist()
  }

  remove(platform: Platform, platformAccountId: string): void {
    this.assertWritable()
    const key = accountKey(platform, platformAccountId)
    const entry = this.file.entries[key]
    if (!entry) throw new Error('account registry: cannot remove an unknown account')
    if (entry.state === 'removed') return
    entry.state = 'removed'
    this.persist()
  }

  listAccounts(): Account[] {
    return this.sortedEntries()
      .filter((entry) => entry.state !== 'removed')
      .map((entry) => ({
        platform: entry.platform,
        platformAccountId: entry.platformAccountId,
        displayName: entry.displayName,
        isActive: entry.state === 'active'
      }))
  }

  listEntries(): AccountRegistryEntry[] {
    return this.sortedEntries().map((entry) => ({ ...entry }))
  }

  private sortedEntries(): AccountRegistryEntry[] {
    return Object.values(this.file.entries).sort((left, right) =>
      accountKey(left.platform, left.platformAccountId).localeCompare(
        accountKey(right.platform, right.platformAccountId)
      )
    )
  }

  private assertWritable(): void {
    if (this.file.storeFormatVersion > ACCOUNT_REGISTRY_FORMAT_VERSION) {
      throw new Error('account registry: refusing to overwrite data written by a newer version')
    }
  }

  private persist(): void {
    this.file.storeFormatVersion = ACCOUNT_REGISTRY_FORMAT_VERSION
    this.storage.write({
      storeFormatVersion: this.file.storeFormatVersion,
      entries: structuredClone(this.file.entries)
    })
  }
}
