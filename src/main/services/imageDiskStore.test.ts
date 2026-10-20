import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ImageDiskStore, type ImageDiskStoreOptions } from './imageDiskStore'

const MIME = new Set(['image/png', 'image/webp'])
const URL_A = 'https://api.vrchat.cloud/api/1/image/file_a/1/256'
const URL_B = 'https://api.vrchat.cloud/api/1/image/file_b/1/256'
const URL_C = 'https://api.vrchat.cloud/api/1/image/file_c/1/256'
const png = (text: string): { contentType: string; bytes: Buffer } => ({
  contentType: 'image/png',
  bytes: Buffer.from(text)
})

let root: string
let directory: string
let now: number

function store(options: Partial<ImageDiskStoreOptions> = {}): ImageDiskStore {
  return new ImageDiskStore({
    directory,
    allowedMimeTypes: MIME,
    maxBodyBytes: 1024,
    now: () => now,
    ...options
  })
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'vrx-image-disk-'))
  directory = join(root, 'image-cache')
  now = 1_000_000
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('ImageDiskStore', () => {
  it('survives a relaunch: a later instance reads what an earlier one wrote', async () => {
    await store().write(URL_A, png('picture'))
    const relaunched = store()
    const image = await relaunched.read(URL_A)
    expect(image?.contentType).toBe('image/png')
    expect(image?.bytes.toString()).toBe('picture')
    expect(await relaunched.read(URL_B)).toBeNull()
    expect(await readdir(directory)).toEqual([ImageDiskStore.keyFor(URL_A)])
  })

  it('rejects and deletes a file whose header names another URL', async () => {
    await store().write(URL_A, png('a'))
    const keyA = ImageDiskStore.keyFor(URL_A)
    const keyB = ImageDiskStore.keyFor(URL_B)
    await writeFile(join(directory, keyB), await readFile(join(directory, keyA)))
    const relaunched = store()
    expect(await relaunched.read(URL_B)).toBeNull()
    expect((await readdir(directory)).sort()).toEqual([keyA])
  })

  it('rejects and deletes corrupt, truncated, or disallowed-type files', async () => {
    const key = ImageDiskStore.keyFor(URL_A)
    await store().write(URL_A, png('a'))
    for (const corrupt of [
      Buffer.from('not an image entry'),
      (await readFile(join(directory, key))).subarray(0, 12)
    ]) {
      await writeFile(join(directory, key), corrupt)
      expect(await store().read(URL_A)).toBeNull()
      expect(await readdir(directory)).toEqual([])
      await store().write(URL_A, png('a'))
    }
    // A store with a narrower allowlist treats the stored type as invalid.
    expect(await store({ allowedMimeTypes: new Set(['image/webp']) }).read(URL_A)).toBeNull()
    expect(await readdir(directory)).toEqual([])
  })

  it('expires entries after the TTL, both on read and when indexing at launch', async () => {
    await store({ ttlMs: 1000 }).write(URL_A, png('a'))
    now += 999
    expect(await store({ ttlMs: 1000 }).read(URL_A)).not.toBeNull()
    now += 1
    expect(await store({ ttlMs: 1000 }).read(URL_A)).toBeNull()
    expect(await readdir(directory)).toEqual([])
  })

  it('does not write disallowed types, empty bodies, or oversized bodies', async () => {
    const disk = store({ maxBodyBytes: 4 })
    await disk.write(URL_A, { contentType: 'text/html', bytes: Buffer.from('a') })
    await disk.write(URL_B, png(''))
    await disk.write(URL_C, png('12345'))
    expect(disk.size).toBe(0)
    expect(await readdir(directory).catch(() => [])).toEqual([])
  })

  it('evicts the least recently used entries past the entry and byte budgets', async () => {
    const disk = store({ maxEntries: 2 })
    await disk.write(URL_A, png('a'))
    now += 1
    await disk.write(URL_B, png('b'))
    now += 1
    expect(await disk.read(URL_A)).not.toBeNull() // A is now the most recent
    now += 1
    await disk.write(URL_C, png('c'))
    expect(disk.size).toBe(2)
    expect(await disk.read(URL_B)).toBeNull()
    expect(await disk.read(URL_A)).not.toBeNull()

    const bytesBound = store({ maxBytes: disk.retainedBytes })
    now += 1
    await bytesBound.write(URL_B, png('b'))
    expect(bytesBound.size).toBe(2)
    expect(bytesBound.retainedBytes).toBeLessThanOrEqual(disk.retainedBytes)
  })

  it('clear removes stored images, fences a write already queued, and leaves other files', async () => {
    await writeFile(join(root, 'keep.txt'), 'x')
    const disk = store()
    await disk.write(URL_A, png('a'))
    await writeFile(join(directory, 'unrelated.json'), '{}')
    const late = disk.write(URL_B, png('b'))
    await disk.clear()
    await late
    expect(await disk.read(URL_A)).toBeNull()
    expect(await disk.read(URL_B)).toBeNull()
    expect(await readdir(directory)).toEqual(['unrelated.json'])
    expect(await readdir(root)).toContain('keep.txt')
    await disk.write(URL_C, png('c'))
    expect(await disk.read(URL_C)).not.toBeNull()
  })

  // Creating symlinks needs extra privileges on Windows.
  it.skipIf(process.platform === 'win32')(
    'ignores symlinks and leftover temp files when indexing',
    async () => {
      await store().write(URL_A, png('a'))
      const keyB = ImageDiskStore.keyFor(URL_B)
      await symlink(join(directory, ImageDiskStore.keyFor(URL_A)), join(directory, keyB))
      const temp = `${ImageDiskStore.keyFor(URL_C)}.0123456789abcdef.tmp`
      await writeFile(join(directory, temp), 'partial')
      const relaunched = store()
      expect(await relaunched.read(URL_B)).toBeNull()
      expect(await relaunched.read(URL_A)).not.toBeNull()
      expect(await readdir(directory)).not.toContain(temp)
    }
  )

  it('degrades to misses when the directory cannot be created', async () => {
    await writeFile(directory, 'a file where the directory should be')
    const log = vi.fn()
    const disk = store({ log })
    await expect(disk.write(URL_A, png('a'))).resolves.toBeUndefined()
    await expect(disk.read(URL_A)).resolves.toBeNull()
    expect(log).toHaveBeenCalledWith('image disk cache unavailable', { code: expect.any(String) })
    expect(JSON.stringify(log.mock.calls)).not.toContain('vrchat')
  })
})
