import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WORLD_CACHE_TTL_MS } from '@shared/constants'
import type { GroupSnapshotEntry } from './adapters/vrchat/GroupResolver'
import type { WorldSnapshotEntry } from './adapters/vrchat/WorldResolver'
import { VRC_METADATA_MAX_WORLDS, VrcMetadataStore } from './vrcMetadataStore'

const world = (id: string, expiresAt: number): WorldSnapshotEntry => ({
  id,
  meta: {
    name: `World ${id}`,
    thumbnailUrl: 'https://api.vrchat.cloud/api/1/image/file_x/1/256',
    capacity: 16,
    shortName: null
  },
  expiresAt
})
const group = (id: string, expiresAt: number): GroupSnapshotEntry => ({
  id,
  meta: { name: `Group ${id}`, iconUrl: null },
  expiresAt
})

let directory: string
let now: number
const store = (): VrcMetadataStore => new VrcMetadataStore({ directory, now: () => now })

beforeEach(async () => {
  directory = join(await mkdtemp(join(tmpdir(), 'vrx-metadata-')), 'vrchat-metadata')
  now = 1_000_000
})
afterEach(async () => {
  await rm(join(directory, '..'), { recursive: true, force: true })
})

describe('VrcMetadataStore', () => {
  it('round-trips one account and keeps accounts apart', async () => {
    const soon = now + 1000
    await store().save('usr_a', { worlds: [world('wrld_1', soon)], groups: [group('grp_1', soon)] })
    expect(store().load('usr_a')).toEqual({
      worlds: [world('wrld_1', soon)],
      groups: [group('grp_1', soon)]
    })
    expect(store().load('usr_b')).toBeNull()
  })

  it("rejects one account's file renamed to another account", async () => {
    await store().save('usr_a', { worlds: [world('wrld_1', now + 1000)], groups: [] })
    const a = join(directory, `${VrcMetadataStore.accountKey('usr_a')}.json`)
    const b = join(directory, `${VrcMetadataStore.accountKey('usr_b')}.json`)
    await writeFile(b, await readFile(a))
    expect(store().load('usr_b')).toBeNull()
  })

  it('drops expired, too-far-future and malformed records but keeps the rest', async () => {
    const key = VrcMetadataStore.accountKey('usr_a')
    await store().save('usr_a', { worlds: [], groups: [] })
    await writeFile(
      join(directory, `${key}.json`),
      JSON.stringify({
        version: 1,
        account: key,
        worlds: [
          world('wrld_ok', now + 1000),
          world('wrld_old', now),
          world('wrld_future', now + WORLD_CACHE_TTL_MS + 1),
          { ...world('wrld_bad', now + 1000), meta: { name: 42 } },
          {
            ...world('wrld_http', now + 1000),
            meta: { ...world('x', 0).meta, thumbnailUrl: 'http://x' }
          }
        ],
        groups: [group('grp_ok', now + 1000), 'nonsense']
      })
    )
    expect(store().load('usr_a')).toEqual({
      worlds: [world('wrld_ok', now + 1000)],
      groups: [group('grp_ok', now + 1000)]
    })
  })

  it('ignores an unreadable, malformed or wrong-version file', async () => {
    const path = join(directory, `${VrcMetadataStore.accountKey('usr_a')}.json`)
    await store().save('usr_a', { worlds: [], groups: [] })
    for (const body of ['{', JSON.stringify({ version: 2 }), JSON.stringify([])]) {
      await writeFile(path, body)
      expect(store().load('usr_a')).toBeNull()
    }
  })

  it('keeps only the newest worlds past the cap', async () => {
    const worlds = Array.from({ length: VRC_METADATA_MAX_WORLDS + 5 }, (_, index) =>
      world(`wrld_${index}`, now + 1000 + index)
    )
    await store().save('usr_a', { worlds, groups: [] })
    const loaded = store().load('usr_a')!
    expect(loaded.worlds).toHaveLength(VRC_METADATA_MAX_WORLDS)
    expect(loaded.worlds.some((entry) => entry.id === 'wrld_0')).toBe(false)
  })

  it('clearAll deletes every account and fences a save already queued', async () => {
    const disk = store()
    await disk.save('usr_a', { worlds: [world('wrld_1', now + 1000)], groups: [] })
    await writeFile(join(directory, 'unrelated.txt'), 'x')
    const late = disk.save('usr_b', { worlds: [world('wrld_2', now + 1000)], groups: [] })
    disk.clearAll()
    await late
    expect(store().load('usr_a')).toBeNull()
    expect(store().load('usr_b')).toBeNull()
    expect(await readdir(directory)).toEqual(['unrelated.txt'])
  })

  it('treats a missing directory as nothing stored', () => {
    expect(store().load('usr_a')).toBeNull()
    expect(() => store().clearAll()).not.toThrow()
  })
})
