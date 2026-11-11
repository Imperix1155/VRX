import { readFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
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
  /**
   * Move a damaged file aside (renamed, never deleted) so the next write
   * starts a fresh one. Throws when the file could not be moved.
   */
  setAside?(): void
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

const formatVersionSchema = z.looseObject({ storeFormatVersion: z.number().int().nonnegative() })

class ElectronAccountRegistryStorage implements AccountRegistryStorage {
  private store: Store<Record<string, unknown>> | null = null

  read(): unknown {
    try {
      return this.getStore().store
    } catch (error) {
      // Not JSON: hand back the text, so the registry can still tell whether a
      // newer build wrote it before deciding what to do.
      if (!(error instanceof SyntaxError)) throw error
      return readFileSync(this.filePath(), 'utf8')
    }
  }

  write(value: AccountRegistryFile): void {
    this.getStore().store = { ...value }
  }

  setAside(): void {
    renameSync(
      this.filePath(),
      join(app.getPath('userData'), `accounts.corrupt-${Date.now()}.json`)
    )
    this.store = null
  }

  private filePath(): string {
    return join(app.getPath('userData'), 'accounts.json')
  }

  private getStore(): Store<Record<string, unknown>> {
    this.store ??= new Store<Record<string, unknown>>({
      name: 'accounts',
      accessPropertiesByDotNotation: false
    })
    return this.store
  }
}

interface AccountRegistryLoadResult {
  file: AccountRegistryFile
  loadValid: boolean
}

function emptyRegistryFile(
  storeFormatVersion = ACCOUNT_REGISTRY_FORMAT_VERSION
): AccountRegistryFile {
  return { storeFormatVersion, entries: {} }
}

function serializedFormatVersion(raw: string): number | null {
  const match = /["']storeFormatVersion["']\s*:\s*(\d+)/.exec(raw)
  if (!match) return null
  const version = Number(match[1])
  return Number.isSafeInteger(version) ? version : null
}

function parseRegistryFile(raw: unknown): AccountRegistryLoadResult {
  if (
    typeof raw === 'object' &&
    raw !== null &&
    !Array.isArray(raw) &&
    Object.keys(raw).length === 0
  ) {
    return { file: emptyRegistryFile(), loadValid: true }
  }

  let candidate = raw
  if (typeof raw === 'string') {
    try {
      candidate = JSON.parse(raw) as unknown
    } catch {
      return {
        file: emptyRegistryFile(serializedFormatVersion(raw) ?? ACCOUNT_REGISTRY_FORMAT_VERSION),
        loadValid: false
      }
    }
  }

  const parsed = fileSchema.safeParse(candidate)
  if (!parsed.success) {
    const formatVersion = formatVersionSchema.safeParse(candidate)
    return {
      file: emptyRegistryFile(
        formatVersion.success
          ? formatVersion.data.storeFormatVersion
          : ACCOUNT_REGISTRY_FORMAT_VERSION
      ),
      loadValid: false
    }
  }

  const entries: Record<string, AccountRegistryEntry> = {}
  for (const [key, entry] of Object.entries(parsed.data.entries)) {
    if (key === accountKey(entry.platform, entry.platformAccountId)) entries[key] = entry
  }
  return {
    file: { storeFormatVersion: parsed.data.storeFormatVersion, entries },
    loadValid: true
  }
}

/** Only a plain system error code is logged; a message could carry a path. */
function errorCode(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
  return typeof code === 'string' && /^E[A-Z0-9_]{1,31}$/.test(code) ? code : 'unknown'
}

type AccountRegistryLog = (message: string, detail?: string) => void

/**
 * Durable source of truth for known accounts; only remove() creates tombstones.
 *
 * A file this build can't read (damaged JSON or the wrong shape) is moved
 * aside as `accounts.corrupt-<time>.json` and the registry starts empty, like
 * social.json; the next sign-in check records the account again. A file from a
 * newer build, or one that could not be read at all (I/O, permissions), stays
 * untouched and the registry stays read-only.
 */
export class AccountRegistry {
  private readonly storage: AccountRegistryStorage
  private file: AccountRegistryFile
  private readonly loadValid: boolean

  constructor(
    private readonly accountSession: AccountSession,
    storage?: AccountRegistryStorage,
    log: AccountRegistryLog = () => undefined
  ) {
    this.storage = storage ?? new ElectronAccountRegistryStorage()
    let loaded: AccountRegistryLoadResult
    try {
      loaded = parseRegistryFile(this.storage.read())
    } catch (error) {
      log('account registry: could not read the file; keeping it', errorCode(error))
      this.file = emptyRegistryFile()
      this.loadValid = false
      return
    }
    // A rejected file from a newer build is kept as it is (see assertWritable()).
    if (loaded.loadValid || loaded.file.storeFormatVersion > ACCOUNT_REGISTRY_FORMAT_VERSION) {
      this.file = loaded.file
      this.loadValid = loaded.loadValid
      return
    }
    try {
      if (!this.storage.setAside) throw new Error('no set-aside in this storage')
      this.storage.setAside()
      log('account registry: damaged file kept as accounts.corrupt-*.json; starting fresh')
      this.file = emptyRegistryFile()
      this.loadValid = true
    } catch (error) {
      log('account registry: could not move the damaged file aside', errorCode(error))
      this.file = loaded.file
      this.loadValid = false
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
    const next: AccountRegistryFile = {
      storeFormatVersion: ACCOUNT_REGISTRY_FORMAT_VERSION,
      entries
    }
    this.storage.write(structuredClone(next))
    this.file = next
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
    if (!this.loadValid) {
      throw new Error(
        'account registry: storage could not be loaded; explicit recovery/reset required'
      )
    }
  }
}
