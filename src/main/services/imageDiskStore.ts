import { createHash, randomBytes } from 'node:crypto'
import { lstat, mkdir, readdir, readFile, rename, rm, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Disk tier behind `AvatarCache` for credentialed VRChat images (api.vrchat.cloud).
 *
 * Each of those images costs one slot in VRChat's one-request-per-second line,
 * so a big roster's pictures used to trickle in for minutes after every launch.
 * VRChat file URLs carry the file id and version, so a URL's bytes do not
 * change; keeping them on disk for a bounded time lets the next launch show
 * them without any request.
 *
 * Contract:
 *  - Files live only in the injected directory (an app.getPath() child), named
 *    by the SHA-256 of the URL. Nothing else is read, written, or removed.
 *  - Every read is validated like a network body: magic, bounded header, the
 *    exact URL, an allowlisted MIME type, the body size limit, and the TTL.
 *    Anything else is deleted and reported as a miss.
 *  - Bounded by entry count and total bytes with least-recently-used eviction
 *    (file mtime, refreshed on hits).
 *  - `clear()` removes every entry and fences writes that started before it.
 *  - Failures are misses. The log callback never receives URLs or paths.
 */

/** Child of app.getPath('userData'); never a VRCX or CVRX location. */
export const IMAGE_DISK_DIRECTORY = 'image-cache'
export const IMAGE_DISK_MAX_ENTRIES = 4000
export const IMAGE_DISK_MAX_BYTES = 128 * 1024 * 1024
export const IMAGE_DISK_TTL_MS = 14 * 24 * 60 * 60 * 1000
/** Upper bound on the JSON header; real headers are a few hundred bytes. */
export const IMAGE_DISK_MAX_HEADER_BYTES = 4096

const INDEX_STAT_BATCH = 64
const MAGIC = Buffer.from('VRXIMG1\n', 'ascii')
const ENTRY_NAME_RE = /^[0-9a-f]{64}$/
const TEMP_NAME_RE = /^[0-9a-f]{64}\.[0-9a-f]{16}\.tmp$/

export interface StoredImage {
  contentType: string
  bytes: Buffer
}

interface IndexEntry {
  size: number
  usedAt: number
}

export interface ImageDiskStoreOptions {
  directory: string
  allowedMimeTypes: ReadonlySet<string>
  maxBodyBytes: number
  now?: () => number
  maxEntries?: number
  maxBytes?: number
  ttlMs?: number
  log?: (message: string, meta?: Record<string, unknown>) => void
}

function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : 'unknown'
}

export class ImageDiskStore {
  private readonly directory: string
  private readonly allowedMimeTypes: ReadonlySet<string>
  private readonly maxBodyBytes: number
  private readonly now: () => number
  private readonly maxEntries: number
  private readonly maxBytes: number
  private readonly ttlMs: number
  private readonly log: (message: string, meta?: Record<string, unknown>) => void
  private readonly index = new Map<string, IndexEntry>()
  private indexedBytes = 0
  private ready: Promise<boolean> | null = null
  private generation = 0
  /** Serializes writes and clears so eviction sees a consistent index. */
  private tail: Promise<void> = Promise.resolve()

  constructor(options: ImageDiskStoreOptions) {
    this.directory = options.directory
    this.allowedMimeTypes = options.allowedMimeTypes
    this.maxBodyBytes = options.maxBodyBytes
    this.now = options.now ?? Date.now
    this.maxEntries = options.maxEntries ?? IMAGE_DISK_MAX_ENTRIES
    this.maxBytes = options.maxBytes ?? IMAGE_DISK_MAX_BYTES
    this.ttlMs = options.ttlMs ?? IMAGE_DISK_TTL_MS
    this.log = options.log ?? ((): void => {})
  }

  static keyFor(url: string): string {
    return createHash('sha256').update(url).digest('hex')
  }

  /** Total bytes the index currently accounts for (test/diagnostic hook). */
  get retainedBytes(): number {
    return this.indexedBytes
  }

  get size(): number {
    return this.index.size
  }

  async read(url: string): Promise<StoredImage | null> {
    const generation = this.generation
    if (!(await this.ensureReady())) return null
    const key = ImageDiskStore.keyFor(url)
    const indexed = this.index.get(key)
    // Only files this store indexed are read, and never past the largest
    // file it could have written.
    if (indexed === undefined || indexed.size > this.maxFileBytes()) return null
    const path = join(this.directory, key)
    let file: Buffer
    try {
      file = await readFile(path)
    } catch (error) {
      if (errorCode(error) !== 'ENOENT')
        this.log('image disk read failed', { code: errorCode(error) })
      this.forget(key)
      return null
    }
    if (generation !== this.generation) return null
    const image = this.decode(file, url)
    if (image === null) {
      await this.remove(key)
      return null
    }
    const now = this.now()
    const entry = this.index.get(key)
    if (entry) entry.usedAt = now
    const seconds = now / 1000
    void utimes(path, seconds, seconds).catch(() => {})
    return image
  }

  write(url: string, image: StoredImage): Promise<void> {
    const generation = this.generation
    return this.serialize(async () => {
      if (generation !== this.generation) return
      if (!this.allowedMimeTypes.has(image.contentType)) return
      if (image.bytes.byteLength === 0 || image.bytes.byteLength > this.maxBodyBytes) return
      if (!(await this.ensureReady())) return
      const key = ImageDiskStore.keyFor(url)
      const file = this.encode(url, image)
      if (file.byteLength > this.maxBytes || file.byteLength > this.maxFileBytes()) return
      const temp = join(this.directory, `${key}.${randomBytes(8).toString('hex')}.tmp`)
      try {
        await writeFile(temp, file, { mode: 0o600 })
        if (generation !== this.generation) {
          await rm(temp, { force: true })
          return
        }
        await rename(temp, join(this.directory, key))
      } catch (error) {
        this.log('image disk write failed', { code: errorCode(error) })
        await rm(temp, { force: true }).catch(() => {})
        return
      }
      this.forget(key)
      this.track(key, file.byteLength, this.now())
      await this.evict()
    })
  }

  /** Delete every stored image (explicit sign-out) and fence in-flight writes. */
  clear(): Promise<void> {
    this.generation += 1
    return this.serialize(async () => {
      this.index.clear()
      this.indexedBytes = 0
      try {
        const names = await readdir(this.directory)
        await Promise.all(
          names
            .filter((name) => ENTRY_NAME_RE.test(name) || TEMP_NAME_RE.test(name))
            .map((name) => rm(join(this.directory, name), { force: true }))
        )
      } catch (error) {
        if (errorCode(error) !== 'ENOENT')
          this.log('image disk clear failed', { code: errorCode(error) })
      }
    })
  }

  private serialize(task: () => Promise<void>): Promise<void> {
    const run = this.tail.then(task, task)
    this.tail = run.catch(() => {})
    return run
  }

  /** Create the directory and index existing entries once; false disables the tier. */
  private ensureReady(): Promise<boolean> {
    this.ready ??= this.loadIndex()
    return this.ready
  }

  private async loadIndex(): Promise<boolean> {
    const generation = this.generation
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 })
      const names = await readdir(this.directory)
      const expiredBefore = this.now() - this.ttlMs
      const indexOne = async (name: string): Promise<void> => {
        const path = join(this.directory, name)
        if (TEMP_NAME_RE.test(name)) {
          await rm(path, { force: true }).catch(() => {})
          return
        }
        if (!ENTRY_NAME_RE.test(name)) return
        try {
          const info = await lstat(path)
          if (!info.isFile()) return
          if (info.mtimeMs < expiredBefore) {
            await rm(path, { force: true })
            return
          }
          // A clear() that ran meanwhile already removed this file.
          if (generation === this.generation) this.track(name, info.size, info.mtimeMs)
        } catch {
          // A concurrently removed or unreadable entry is simply not indexed.
        }
      }
      // Bounded parallel stats: the first picture of a launch waits for this.
      for (let start = 0; start < names.length; start += INDEX_STAT_BATCH) {
        await Promise.all(names.slice(start, start + INDEX_STAT_BATCH).map(indexOne))
      }
      await this.evict()
      return true
    } catch (error) {
      this.log('image disk cache unavailable', { code: errorCode(error) })
      return false
    }
  }

  private maxFileBytes(): number {
    return MAGIC.byteLength + 4 + IMAGE_DISK_MAX_HEADER_BYTES + this.maxBodyBytes
  }

  private encode(url: string, image: StoredImage): Buffer {
    const header = Buffer.from(
      JSON.stringify({ url, contentType: image.contentType, storedAt: this.now() }),
      'utf8'
    )
    const length = Buffer.alloc(4)
    length.writeUInt32BE(header.byteLength)
    return Buffer.concat([MAGIC, length, header, image.bytes])
  }

  private decode(file: Buffer, url: string): StoredImage | null {
    const headerStart = MAGIC.byteLength + 4
    if (file.byteLength < headerStart || !file.subarray(0, MAGIC.byteLength).equals(MAGIC))
      return null
    const headerLength = file.readUInt32BE(MAGIC.byteLength)
    if (headerLength > IMAGE_DISK_MAX_HEADER_BYTES || file.byteLength < headerStart + headerLength)
      return null
    let header: unknown
    try {
      header = JSON.parse(file.subarray(headerStart, headerStart + headerLength).toString('utf8'))
    } catch {
      return null
    }
    if (typeof header !== 'object' || header === null) return null
    const { url: storedUrl, contentType, storedAt } = header as Record<string, unknown>
    if (storedUrl !== url || typeof contentType !== 'string' || typeof storedAt !== 'number')
      return null
    if (!this.allowedMimeTypes.has(contentType)) return null
    const now = this.now()
    if (!Number.isFinite(storedAt) || storedAt > now || now - storedAt >= this.ttlMs) return null
    const bytes = file.subarray(headerStart + headerLength)
    if (bytes.byteLength === 0 || bytes.byteLength > this.maxBodyBytes) return null
    return { contentType, bytes }
  }

  private track(key: string, size: number, usedAt: number): void {
    this.index.set(key, { size, usedAt })
    this.indexedBytes += size
  }

  private forget(key: string): void {
    const entry = this.index.get(key)
    if (!entry) return
    this.indexedBytes -= entry.size
    this.index.delete(key)
  }

  private async remove(key: string): Promise<void> {
    this.forget(key)
    await rm(join(this.directory, key), { force: true }).catch(() => {})
  }

  private async evict(): Promise<void> {
    if (this.index.size <= this.maxEntries && this.indexedBytes <= this.maxBytes) return
    const oldestFirst = [...this.index].sort((left, right) => left[1].usedAt - right[1].usedAt)
    for (const [key] of oldestFirst) {
      if (this.index.size <= this.maxEntries && this.indexedBytes <= this.maxBytes) return
      await this.remove(key)
    }
  }
}
