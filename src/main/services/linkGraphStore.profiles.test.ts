import { describe, expect, it, vi } from 'vitest'
import { LinkGraphStore, type LinkGraphStorage } from './linkGraphStore'

vi.mock('electron', () => ({
  app: {
    getPath: () => {
      throw new Error('fixture only')
    }
  }
}))
vi.mock('electron-store', () => ({ default: class {} }))

const vrc = { platform: 'vrchat' as const, platformAccountId: 'owner_vrc', friendId: 'friend_vrc' }
const cvr = {
  platform: 'chilloutvr' as const,
  platformAccountId: 'owner_cvr',
  friendId: 'friend_cvr'
}
const vrc2 = { ...vrc, friendId: 'friend_vrc2' }
const cvr2 = { ...cvr, friendId: 'friend_cvr2' }

function fixture(): {
  graph: LinkGraphStore
  storage: LinkGraphStorage
  writes: () => number
  fail: () => void
} {
  let value: unknown = {}
  let writes = 0
  let fail = false
  let id = 0
  const storage: LinkGraphStorage = {
    read: () => value,
    write: (next) => {
      if (fail) throw new Error('fixture write failure')
      value = structuredClone(next)
      writes++
    }
  }
  const graph = new LinkGraphStore(storage, () => `person_${++id}`)
  return {
    graph,
    storage,
    writes: () => writes,
    fail: () => {
      fail = true
    }
  }
}

describe('transactional linked profiles', () => {
  it('refreshes preferred fallback names in one transaction without changing notes or custom names', () => {
    const { graph, storage, writes } = fixture()
    const a = graph.apply({
      kind: 'replace',
      members: [vrc, cvr],
      preferredPlatform: 'vrchat',
      defaultName: 'A',
      expectedPeople: []
    })!
    const b = graph.apply({
      kind: 'replace',
      members: [vrc2, cvr2],
      preferredPlatform: 'chilloutvr',
      defaultName: 'B',
      expectedPeople: []
    })!
    graph.apply({
      kind: 'update',
      personId: a.id,
      expectedRevision: 1,
      patch: { sharedNote: 'Keep', customName: 'Custom' }
    })
    const before = graph.snapshot()
    const writeCount = writes()
    const refreshed = graph.refreshDefaultNames([
      { personId: a.id, expectedRevision: 2, member: vrc, defaultName: 'Renamed A' },
      { personId: b.id, expectedRevision: 1, member: cvr2, defaultName: 'Renamed B' }
    ])
    expect(writes()).toBe(writeCount + 1)
    expect(refreshed.storeRevision).toBe(before.storeRevision + 1)
    expect(refreshed.profiles[0]).toMatchObject({
      defaultName: 'Renamed A',
      customName: 'Custom',
      sharedNote: 'Keep',
      revision: 3
    })
    expect(refreshed.profiles[1]).toMatchObject({ defaultName: 'Renamed B', revision: 2 })
    expect(new LinkGraphStore(storage).snapshot()).toEqual(refreshed)
    expect(() => graph.apply({ kind: 'unlink', personId: a.id, expectedRevision: 2 })).toThrow(
      'stale confirmation'
    )
    graph.refreshDefaultNames([
      { personId: a.id, expectedRevision: 3, member: vrc, defaultName: 'Renamed A' }
    ])
    expect(writes()).toBe(writeCount + 1)
  })

  it('ignores stale revisions, nonpreferred members and another account owner during name refresh', () => {
    const { graph, writes } = fixture()
    const person = graph.apply({
      kind: 'replace',
      members: [vrc, cvr],
      preferredPlatform: 'vrchat',
      defaultName: 'A',
      expectedPeople: []
    })!
    const before = graph.snapshot()
    for (const update of [
      { personId: person.id, expectedRevision: 2, member: vrc, defaultName: 'Wrong' },
      { personId: person.id, expectedRevision: 1, member: cvr, defaultName: 'Wrong' },
      {
        personId: person.id,
        expectedRevision: 1,
        member: { ...vrc, platformAccountId: 'someone_else' },
        defaultName: 'Wrong'
      }
    ])
      expect(graph.refreshDefaultNames([update])).toEqual(before)
    expect(writes()).toBe(1)
  })

  it('preserves all fallback names after a failed batched refresh and rejects accessor inputs without executing them', () => {
    const { graph, fail } = fixture()
    const person = graph.apply({
      kind: 'replace',
      members: [vrc, cvr],
      preferredPlatform: 'vrchat',
      defaultName: 'A',
      expectedPeople: []
    })!
    const before = graph.snapshot()
    const getter = vi.fn(() => 'Bad')
    const hostile = {
      personId: person.id,
      expectedRevision: 1,
      member: vrc,
      get defaultName() {
        return getter()
      }
    }
    expect(() => graph.refreshDefaultNames([hostile])).toThrow()
    expect(getter).not.toHaveBeenCalled()
    fail()
    expect(() =>
      graph.refreshDefaultNames([
        { personId: person.id, expectedRevision: 1, member: vrc, defaultName: 'Renamed' }
      ])
    ).toThrow()
    expect(graph.snapshot()).toEqual(before)
  })
  it('creates one profile with a blank independent note and round-trips preferences', () => {
    const { graph, storage } = fixture()
    const person = graph.apply({
      kind: 'replace',
      members: [vrc, cvr],
      preferredPlatform: 'vrchat',
      defaultName: 'Alex',
      expectedPeople: []
    })!
    expect(person).toEqual({
      id: 'person_1',
      members: [vrc, cvr],
      customName: null,
      defaultName: 'Alex',
      preferredPlatform: 'vrchat',
      pictureMode: 'preferred',
      sharedNote: '',
      revision: 1
    })
    graph.apply({
      kind: 'update',
      personId: person.id,
      expectedRevision: 1,
      patch: { sharedNote: 'shared', customName: 'Local name', pictureMode: 'merged' }
    })
    expect(new LinkGraphStore(storage).list()).toEqual([
      {
        ...person,
        sharedNote: 'shared',
        customName: 'Local name',
        pictureMode: 'merged',
        revision: 2
      }
    ])
  })

  it('replaces two reviewed pairs with one write and leaves unselected accounts unlinked', () => {
    const { graph, writes } = fixture()
    const a = graph.apply({
      kind: 'replace',
      members: [vrc, cvr],
      preferredPlatform: 'vrchat',
      defaultName: 'A',
      expectedPeople: []
    })!
    const b = graph.apply({
      kind: 'replace',
      members: [vrc2, cvr2],
      preferredPlatform: 'chilloutvr',
      defaultName: 'B',
      expectedPeople: []
    })!
    const before = writes()
    const result = graph.apply({
      kind: 'replace',
      members: [vrc, cvr2],
      preferredPlatform: 'chilloutvr',
      defaultName: 'New',
      expectedPeople: [a, b].map(({ id, revision }) => ({ id, revision }))
    })!
    expect(writes() - before).toBe(1)
    expect(graph.list()).toEqual([result])
    expect(result.sharedNote).toBe('')
    expect(graph.getByMember(cvr)).toBeNull()
    expect(graph.getByMember(vrc2)).toBeNull()
  })

  it('preserves both reviewed pairs and notes when replacement cannot commit', () => {
    const { graph, storage, fail } = fixture()
    const a = graph.apply({
      kind: 'replace',
      members: [vrc, cvr],
      preferredPlatform: 'vrchat',
      defaultName: 'A',
      expectedPeople: []
    })!
    const b = graph.apply({
      kind: 'replace',
      members: [vrc2, cvr2],
      preferredPlatform: 'vrchat',
      defaultName: 'B',
      expectedPeople: []
    })!
    const edited = graph.apply({
      kind: 'update',
      personId: a.id,
      expectedRevision: a.revision,
      patch: { sharedNote: 'keep me' }
    })!
    const before = structuredClone(storage.read())
    fail()
    expect(() =>
      graph.apply({
        kind: 'replace',
        members: [vrc, cvr2],
        preferredPlatform: 'vrchat',
        defaultName: 'New',
        expectedPeople: [edited, b].map(({ id, revision }) => ({ id, revision }))
      })
    ).toThrow()
    expect(storage.read()).toEqual(before)
    expect(graph.list()).toEqual([edited, b])
  })

  it('rejects unlink and replacement after a reviewed shared note changes', () => {
    const { graph, storage } = fixture()
    const a = graph.apply({
      kind: 'replace',
      members: [vrc, cvr],
      preferredPlatform: 'vrchat',
      defaultName: 'A',
      expectedPeople: []
    })!
    graph.apply({
      kind: 'update',
      personId: a.id,
      expectedRevision: a.revision,
      patch: { sharedNote: 'new text' }
    })
    const before = structuredClone(storage.read())
    expect(() =>
      graph.apply({ kind: 'unlink', personId: a.id, expectedRevision: a.revision })
    ).toThrow(/stale/)
    expect(() =>
      graph.apply({
        kind: 'replace',
        members: [vrc, cvr2],
        preferredPlatform: 'vrchat',
        defaultName: 'New',
        expectedPeople: [{ id: a.id, revision: a.revision }]
      })
    ).toThrow(/stale/)
    expect(storage.read()).toEqual(before)
  })

  it('same-pair linking does not reset notes, preferences, revisions or generate another id', () => {
    const { graph, writes } = fixture()
    const a = graph.apply({
      kind: 'replace',
      members: [vrc, cvr],
      preferredPlatform: 'vrchat',
      defaultName: 'A',
      expectedPeople: []
    })!
    const edited = graph.apply({
      kind: 'update',
      personId: a.id,
      expectedRevision: a.revision,
      patch: { sharedNote: 'keep', customName: 'Mine' }
    })!
    const before = writes()
    expect(
      graph.apply({
        kind: 'replace',
        members: [cvr, vrc],
        preferredPlatform: 'chilloutvr',
        defaultName: 'Other',
        expectedPeople: [{ id: edited.id, revision: edited.revision }]
      })
    ).toEqual(edited)
    expect(writes()).toBe(before)
  })
})
