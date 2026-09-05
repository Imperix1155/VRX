import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LinkProfileStorage } from './linkProfileStorage'
import { LinkGraphStore } from './linkGraphStore'

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
