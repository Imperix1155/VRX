import { constants } from 'node:fs'
import { open, rm, type FileHandle } from 'node:fs/promises'

const COPY_BUFFER_BYTES = 1024 * 1024

export interface SnapshotFileVersion {
  dev: bigint
  ino: bigint
  nlink: bigint
  size: bigint
  mtimeNs: bigint
  ctimeNs: bigint
}

export interface OpenSnapshot {
  handle: FileHandle
  version: SnapshotFileVersion
}

function sourceChangedError(): Error {
  return Object.assign(new Error('VRCX source changed during snapshot'), { code: 'EBUSY' })
}

export async function copyOpenFile(
  source: FileHandle,
  destinationPath: string,
  sourceBytes: number
): Promise<OpenSnapshot> {
  if (!Number.isSafeInteger(sourceBytes) || sourceBytes < 1) throw sourceChangedError()

  const destination = await open(
    destinationPath,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW |
      constants.O_NONBLOCK,
    0o600
  )
  let completed = false

  try {
    const buffer = Buffer.allocUnsafe(Math.min(COPY_BUFFER_BYTES, sourceBytes))
    let position = 0
    while (position < sourceBytes) {
      const requested = Math.min(buffer.length, sourceBytes - position)
      const { bytesRead } = await source.read(buffer, 0, requested, position)
      if (bytesRead < 1) throw sourceChangedError()

      let written = 0
      while (written < bytesRead) {
        const result = await destination.write(
          buffer,
          written,
          bytesRead - written,
          position + written
        )
        if (result.bytesWritten < 1) throw sourceChangedError()
        written += result.bytesWritten
      }
      position += bytesRead
    }
    await destination.sync()
    const value = await destination.stat({ bigint: true })
    if (!value.isFile() || value.nlink !== 1n) throw sourceChangedError()
    completed = true
    return {
      handle: destination,
      version: {
        dev: value.dev,
        ino: value.ino,
        nlink: value.nlink,
        size: value.size,
        mtimeNs: value.mtimeNs,
        ctimeNs: value.ctimeNs
      }
    }
  } finally {
    if (!completed) {
      await destination.close().catch(() => undefined)
      await rm(destinationPath, { force: true }).catch(() => undefined)
    }
  }
}
