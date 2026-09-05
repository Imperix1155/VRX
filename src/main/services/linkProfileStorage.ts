import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import type { LinkProfileFile } from '@shared/linkedProfiles'
import type { LinkGraphFile, LinkGraphStorage } from './linkGraphStore'

interface StorageOperations {
  rename: typeof renameSync
}

const MAX_FILE_BYTES = 32 * 1024 * 1024

/** One file and one rename are the commit boundary for links and shared notes. */
export class LinkProfileStorage implements LinkGraphStorage {
  private readonly path: string
  private originalBytes: Buffer | null = null

  constructor(
    private readonly directory: string = app.getPath('userData'),
    private readonly operations: StorageOperations = { rename: renameSync }
  ) {
    this.path = join(directory, 'link-graph.json')
  }

  read(): unknown {
    try {
      const stat = lstatSync(this.path)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES)
        throw new Error('link storage: invalid file')
      this.originalBytes = readFileSync(this.path)
      return this.originalBytes.toString('utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      this.originalBytes = null
      return {}
    }
  }

  backup(): void {
    if (!this.originalBytes) throw new Error('link storage: missing migration source')
    const path = join(this.directory, 'link-graph.v1.backup.json')
    let fd: number | undefined
    try {
      fd = openSync(path, 'wx', 0o600)
      writeFileSync(fd, this.originalBytes)
      fsyncSync(fd)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const stat = lstatSync(path)
      if (!stat.isFile() || stat.isSymbolicLink() || !readFileSync(path).equals(this.originalBytes))
        throw new Error('link storage: conflicting migration backup')
    } finally {
      if (fd !== undefined) closeSync(fd)
    }
  }

  write(value: LinkGraphFile | LinkProfileFile): void {
    const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n')
    if (bytes.length > MAX_FILE_BYTES) throw new Error('link storage: file too large')
    mkdirSync(this.directory, { recursive: true })
    const temporary = join(this.directory, `.link-graph-${randomUUID()}.tmp`)
    let fd: number | undefined
    let owned = false
    let committed = false
    try {
      fd = openSync(temporary, 'wx', 0o600)
      owned = true
      writeFileSync(fd, bytes)
      fsyncSync(fd)
      closeSync(fd)
      fd = undefined
      try {
        this.operations.rename(temporary, this.path)
        committed = true
      } catch (error) {
        // A wrapper can report an error after rename. Never blindly replay a
        // destructive command when the complete desired document is already durable.
        try {
          committed = readFileSync(this.path).equals(bytes)
        } catch {
          committed = false
        }
        if (!committed) throw error
      }
      this.originalBytes = bytes
      // Directory sync is best-effort on platforms that do not permit it. The
      // rename already committed; a later error cannot truthfully mean rollback.
      let directoryFd: number | undefined
      try {
        directoryFd = openSync(this.directory, 'r')
        fsyncSync(directoryFd)
      } catch {
        /* Platform-dependent directory sync support. */
      } finally {
        if (directoryFd !== undefined) {
          try {
            closeSync(directoryFd)
          } catch {
            /* Already committed. */
          }
        }
      }
    } finally {
      if (fd !== undefined) {
        try {
          closeSync(fd)
        } catch {
          /* Preserve original write error. */
        }
      }
      if (owned && existsSync(temporary)) {
        try {
          unlinkSync(temporary)
        } catch {
          /* Never erase another path or reinterpret the commit. */
        }
      }
    }
  }
}
