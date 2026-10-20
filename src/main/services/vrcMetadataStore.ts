import { createHash, randomBytes } from 'node:crypto'
import { readFileSync, readdirSync, rmSync } from 'node:fs'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { WORLD_CACHE_TTL_MS } from '@shared/constants'
import type { GroupSnapshotEntry } from './adapters/vrchat/GroupResolver'
import { GROUP_CACHE_MAX, GROUP_CACHE_TTL_MS } from './adapters/vrchat/GroupResolver'
import { WORLD_CACHE_MAX, type WorldSnapshotEntry } from './adapters/vrchat/WorldResolver'

/**
 * Launch-to-launch copy of VRChat world and group names (WorldResolver and
 * GroupResolver caches) for one signed-in account.
 *
 * Every VRChat lookup waits in the one-request-per-second line, so after a
 * launch friends' world and group names used to fill in one by one. Entries
 * keep their original 24-hour expiry, so nothing is served for longer than the
 * in-memory caches already allow.
 *
 * Contract:
 *  - One JSON file per account under the injected directory (an app.getPath()
 *    child), named by the SHA-256 of the account id; the file repeats that hash
 *    and is ignored if it differs. Account data never crosses accounts.
 *  - Reads are bounded and validated record by record; invalid records are
 *    dropped, an invalid file is ignored. Writes are atomic (temp + rename).
 *  - `clearAll()` deletes every account's file (explicit VRChat sign-out).
 *  - Failures degrade to "nothing stored". The log callback never receives
 *    account ids, names, or paths.
 */

export const VRC_METADATA_DIRECTORY = 'vrchat-metadata'
export const VRC_METADATA_MAX_WORLDS = WORLD_CACHE_MAX
export const VRC_METADATA_MAX_GROUPS = GROUP_CACHE_MAX
/** Generous upper bound: a full file is well under 1 MiB. */
export const VRC_METADATA_MAX_FILE_BYTES = 2 * 1024 * 1024

const FILE_NAME_RE = /^[0-9a-f]{64}\.json$/
const TEMP_NAME_RE = /^[0-9a-f]{64}\.[0-9a-f]{16}\.tmp$/
const MAX_TEXT = 512
const MAX_URL = 2048

const idSchema = z.string().min(1).max(128)
const textSchema = z.string().min(1).max(MAX_TEXT)
const urlSchema = z.string().max(MAX_URL).startsWith('https://')
const expiresAtSchema = z.number().finite()

const worldRecordSchema = z.object({
  id: idSchema,
  meta: z.object({
    name: textSchema,
    thumbnailUrl: urlSchema.nullable(),
    capacity: z.number().int().min(0).max(100_000).nullable(),
    shortName: z.string().max(MAX_TEXT).nullable()
  }),
  expiresAt: expiresAtSchema
})
const groupRecordSchema = z.object({
  id: idSchema,
  meta: z.object({ name: textSchema, iconUrl: urlSchema.nullable() }),
  expiresAt: expiresAtSchema
})
const fileSchema = z.object({
  version: z.literal(1),
  account: z.string().regex(/^[0-9a-f]{64}$/),
  worlds: z.array(z.unknown()).max(VRC_METADATA_MAX_WORLDS),
  groups: z.array(z.unknown()).max(VRC_METADATA_MAX_GROUPS)
})

export interface VrcMetadataSnapshot {
  worlds: WorldSnapshotEntry[]
  groups: GroupSnapshotEntry[]
}

export interface VrcMetadataStoreOptions {
  directory: string
  now?: () => number
  log?: (message: string, meta?: Record<string, unknown>) => void
}

function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : 'unknown'
}

/** Keep the entries that expire last; the caps match the in-memory caches. */
function newest<T extends { expiresAt: number }>(entries: readonly T[], limit: number): T[] {
  return entries.length <= limit
    ? [...entries]
    : [...entries].sort((left, right) => right.expiresAt - left.expiresAt).slice(0, limit)
}

export class VrcMetadataStore {
  private readonly directory: string
  private readonly now: () => number
  private readonly log: (message: string, meta?: Record<string, unknown>) => void
  private generation = 0
  private tail: Promise<void> = Promise.resolve()

  constructor(options: VrcMetadataStoreOptions) {
    this.directory = options.directory
    this.now = options.now ?? Date.now
    this.log = options.log ?? ((): void => {})
  }

  static accountKey(accountId: string): string {
    return createHash('sha256').update(`vrchat\u0000${accountId}`).digest('hex')
  }

  /** Synchronous so the first roster after sign-in is already enriched. */
  load(accountId: string): VrcMetadataSnapshot | null {
    const key = VrcMetadataStore.accountKey(accountId)
    let raw: string
    try {
      const file = readFileSync(join(this.directory, `${key}.json`))
      if (file.byteLength > VRC_METADATA_MAX_FILE_BYTES) return null
      raw = file.toString('utf8')
    } catch (error) {
      if (errorCode(error) !== 'ENOENT')
        this.log('vrchat metadata read failed', { code: errorCode(error) })
      return null
    }
    let parsed: z.infer<typeof fileSchema>
    try {
      const result = fileSchema.safeParse(JSON.parse(raw))
      if (!result.success || result.data.account !== key) return null
      parsed = result.data
    } catch {
      return null
    }
    const now = this.now()
    const live = (expiresAt: number, ttl: number): boolean =>
      expiresAt > now && expiresAt <= now + ttl
    const worlds: WorldSnapshotEntry[] = []
    for (const record of parsed.worlds) {
      const world = worldRecordSchema.safeParse(record)
      if (world.success && live(world.data.expiresAt, WORLD_CACHE_TTL_MS)) worlds.push(world.data)
    }
    const groups: GroupSnapshotEntry[] = []
    for (const record of parsed.groups) {
      const group = groupRecordSchema.safeParse(record)
      if (group.success && live(group.data.expiresAt, GROUP_CACHE_TTL_MS)) groups.push(group.data)
    }
    return { worlds, groups }
  }

  save(accountId: string, snapshot: VrcMetadataSnapshot): Promise<void> {
    const generation = this.generation
    const key = VrcMetadataStore.accountKey(accountId)
    const body = JSON.stringify({
      version: 1,
      account: key,
      worlds: newest(snapshot.worlds, VRC_METADATA_MAX_WORLDS),
      groups: newest(snapshot.groups, VRC_METADATA_MAX_GROUPS)
    })
    return this.serialize(async () => {
      if (generation !== this.generation) return
      if (Buffer.byteLength(body) > VRC_METADATA_MAX_FILE_BYTES) return
      const temp = join(this.directory, `${key}.${randomBytes(8).toString('hex')}.tmp`)
      try {
        await mkdir(this.directory, { recursive: true, mode: 0o700 })
        await writeFile(temp, body, { mode: 0o600 })
        if (generation !== this.generation) {
          await rm(temp, { force: true })
          return
        }
        await rename(temp, join(this.directory, `${key}.json`))
        // A sign-out that ran while the rename was in flight wins.
        if (generation !== this.generation)
          await rm(join(this.directory, `${key}.json`), { force: true })
      } catch (error) {
        this.log('vrchat metadata write failed', { code: errorCode(error) })
        await rm(temp, { force: true }).catch(() => {})
      }
    })
  }

  /** Explicit VRChat sign-out: delete every stored account file and fence pending saves. */
  clearAll(): void {
    this.generation += 1
    try {
      for (const name of readdirSync(this.directory)) {
        if (FILE_NAME_RE.test(name) || TEMP_NAME_RE.test(name))
          rmSync(join(this.directory, name), { force: true })
      }
    } catch (error) {
      if (errorCode(error) !== 'ENOENT')
        this.log('vrchat metadata clear failed', { code: errorCode(error) })
    }
  }

  private serialize(task: () => Promise<void>): Promise<void> {
    const run = this.tail.then(task, task)
    this.tail = run.catch(() => {})
    return run
  }
}
