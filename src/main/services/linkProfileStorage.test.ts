import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LinkProfileStorage } from './linkProfileStorage'
import { LinkGraphStore } from './linkGraphStore'
import type { LinkProfileFile } from '@shared/linkedProfiles'

vi.mock('electron', () => ({
  app: {
    getPath: () => {
      throw new Error('fixture only')
    }
  }
}))
const dirs: string[] = []
function directory(): string {
  const path = mkdtempSync(join(tmpdir(), 'vrx-links-test-'))
  dirs.push(path)
  return path
}
afterEach(() => {
  for (const path of dirs.splice(0)) rmSync(path, { recursive: true, force: true })
})
const members = [
  { platform: 'vrchat' as const, platformAccountId: 'owner_vrc', friendId: 'friend_vrc' },
  { platform: 'chilloutvr' as const, platformAccountId: 'owner_cvr', friendId: 'friend_cvr' }
] as const

describe('strict link profile storage', () => {
  it('rejects oversized valid profiles before replacing a readable file', () => {
    const dir = directory()
    const storage = new LinkProfileStorage(dir)
    const graph = new LinkGraphStore(storage, () => 'original')
    const original = graph.apply({
      kind: 'replace',
      members: [...members],
      defaultName: 'Original',
      preferredPlatform: 'vrchat',
      expectedPeople: []
    })!
    const before = readFileSync(join(dir, 'link-graph.json'))
    const large: LinkProfileFile = { storeFormatVersion: 2, revision: 2, people: {} }
    for (let index = 0; index < 5000; index += 1) {
      const id = `person_${index}`
      large.people[id] = {
        id,
        members: members.map((member) => ({
          ...member,
          platformAccountId: 'a'.repeat(128),
          friendId: `friend_${index}`.padEnd(256, 'a')
        })) as typeof original.members,
        customName: '\0'.repeat(256),
        defaultName: '\0'.repeat(256),
        preferredPlatform: 'vrchat',
        pictureMode: 'preferred',
        sharedNote: '\0'.repeat(500),
        revision: 1
      }
    }
    // Verify schema validity independently of the filesystem byte ceiling.
    expect(new LinkGraphStore({ read: () => large, write: vi.fn() }).list()).toHaveLength(5000)
    expect(Buffer.byteLength(JSON.stringify(large, null, 2) + '\n')).toBeGreaterThan(
      32 * 1024 * 1024
    )
    expect(() => storage.write(large)).toThrow('link storage: file too large')
    expect(readFileSync(join(dir, 'link-graph.json')).equals(before)).toBe(true)
    expect(readdirSync(dir)).toEqual(['link-graph.json'])
    expect(new LinkGraphStore(new LinkProfileStorage(dir)).list()).toEqual([original])
    // A large valid document below the ceiling remains writable and restart-safe.
    for (let index = 4500; index < 5000; index += 1) delete large.people[`person_${index}`]
    expect(Buffer.byteLength(JSON.stringify(large, null, 2) + '\n')).toBeLessThan(32 * 1024 * 1024)
    storage.write(large)
    expect(new LinkGraphStore(new LinkProfileStorage(dir)).list()).toHaveLength(4500)
  })

  it('migrates fully valid v1 once and retains the exact original bytes', () => {
    const dir = directory()
    const original =
      JSON.stringify(
        {
          storeFormatVersion: 1,
          people: { original: { id: 'original', members, displayName: 'Custom' } }
        },
        null,
        4
      ) + '\n'
    writeFileSync(join(dir, 'link-graph.json'), original)
    const graph = new LinkGraphStore(new LinkProfileStorage(dir))
    expect(graph.list()).toEqual([
      {
        id: 'original',
        members,
        customName: 'Custom',
        defaultName: 'Custom',
        preferredPlatform: 'vrchat',
        pictureMode: 'preferred',
        sharedNote: '',
        revision: 1
      }
    ])
    expect(readFileSync(join(dir, 'link-graph.v1.backup.json'), 'utf8')).toBe(original)
    const migrated = readFileSync(join(dir, 'link-graph.json'), 'utf8')
    expect(JSON.parse(migrated).storeFormatVersion).toBe(2)
    expect(new LinkGraphStore(new LinkProfileStorage(dir)).list()).toEqual(graph.list())
    expect(readFileSync(join(dir, 'link-graph.json'), 'utf8')).toBe(migrated)
  })

  it('failed migration leaves the original readable and byte-identical', () => {
    const dir = directory()
    const original = JSON.stringify({
      storeFormatVersion: 1,
      people: { original: { id: 'original', members, displayName: null } }
    })
    writeFileSync(join(dir, 'link-graph.json'), original)
    const storage = new LinkProfileStorage(dir, {
      rename: () => {
        throw new Error('EXDEV fixture')
      }
    })
    expect(new LinkGraphStore(storage).list()).toHaveLength(1)
    expect(readFileSync(join(dir, 'link-graph.json'), 'utf8')).toBe(original)
    expect(readdirSync(dir).some((name) => name.endsWith('.tmp'))).toBe(false)
  })

  it('failed replacement rename preserves the entire old profile after restart', () => {
    const dir = directory()
    const graph = new LinkGraphStore(new LinkProfileStorage(dir), () => 'person')
    const person = graph.apply({
      kind: 'replace',
      members: [...members],
      defaultName: 'A',
      preferredPlatform: 'vrchat',
      expectedPeople: []
    })!
    const before = readFileSync(join(dir, 'link-graph.json'), 'utf8')
    const broken = new LinkGraphStore(
      new LinkProfileStorage(dir, {
        rename: () => {
          throw new Error('rename failure')
        }
      })
    )
    expect(() =>
      broken.apply({ kind: 'unlink', personId: person.id, expectedRevision: 1 })
    ).toThrow()
    expect(readFileSync(join(dir, 'link-graph.json'), 'utf8')).toBe(before)
    expect(new LinkGraphStore(new LinkProfileStorage(dir)).list()).toEqual([person])
  })

  it('reconciles a rename that committed before reporting an error', () => {
    const dir = directory()
    const graph = new LinkGraphStore(
      new LinkProfileStorage(dir, {
        rename: (a, b) => {
          renameSync(a, b)
          throw new Error('ambiguous completion')
        }
      }),
      () => 'person'
    )
    expect(
      graph.apply({
        kind: 'replace',
        members: [...members],
        defaultName: 'A',
        preferredPlatform: 'vrchat',
        expectedPeople: []
      })?.id
    ).toBe('person')
    expect(new LinkGraphStore(new LinkProfileStorage(dir)).list()).toHaveLength(1)
  })

  it.each(['{"storeFormatVersion":2,', '{"storeFormatVersion":999,"future":true}'])(
    'never replaces unreadable or future data: %s',
    (input) => {
      const dir = directory()
      writeFileSync(join(dir, 'link-graph.json'), input)
      const graph = new LinkGraphStore(new LinkProfileStorage(dir))
      expect(graph.list()).toEqual([])
      expect(() =>
        graph.apply({
          kind: 'replace',
          members: [...members],
          defaultName: 'A',
          preferredPlatform: 'vrchat',
          expectedPeople: []
        })
      ).toThrow()
      expect(readFileSync(join(dir, 'link-graph.json'), 'utf8')).toBe(input)
    }
  )
})
