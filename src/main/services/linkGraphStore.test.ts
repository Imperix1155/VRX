import { describe, expect, it, vi } from 'vitest'
import type { LinkedPersonMember } from '@shared/types'
import type { LinkChange, LinkedProfile, LinkProfileFile } from '@shared/linkedProfiles'
import {
  LINK_GRAPH_FORMAT_VERSION,
  LinkGraphStore,
  type LinkGraphFile,
  type LinkGraphStorage
} from './linkGraphStore'

vi.mock('electron-store', () => ({ default: class {} }))
vi.mock('electron', () => ({ app: { getPath: () => '/fixture-user-data' } }))

class MemoryLinkGraphStorage implements LinkGraphStorage {
  value: unknown = {}
  writes: Array<LinkGraphFile | LinkProfileFile> = []
  writeError: Error | null = null
  backupError: Error | null = null
  reads = 0
  backups = 0

  read(): unknown {
    this.reads += 1
    return this.value
  }

  write(value: LinkGraphFile | LinkProfileFile): void {
    if (this.writeError) throw this.writeError
    this.value = structuredClone(value)
    this.writes.push(structuredClone(value))
  }

  backup(): void {
    if (this.backupError) throw this.backupError
    this.backups += 1
  }
}

interface LegacyLinkedPerson {
  id: string
  members: [LinkedPersonMember, LinkedPersonMember]
  displayName: string | null
}

function asLegacyPerson(profile: LinkedProfile): LegacyLinkedPerson {
  return {
    id: profile.id,
    members: profile.members,
    displayName: profile.customName
  }
}

/**
 * Keeps the pre-v2 hardening cases compact while every mutation still crosses
 * the production v2 apply boundary. New behavior tests below use the real API.
 */
class FixtureLinkGraphStore {
  private readonly graph: LinkGraphStore

  constructor(storage?: LinkGraphStorage, createPersonId?: () => string) {
    this.graph = new LinkGraphStore(storage, createPersonId)
  }

  list(): LegacyLinkedPerson[] {
    return this.graph.list().map(asLegacyPerson)
  }

  getByMember(member: LinkedPersonMember): LegacyLinkedPerson | null {
    const profile = this.graph.getByMember(member)
    return profile === null ? null : asLegacyPerson(profile)
  }

  link(
    firstMember: LinkedPersonMember,
    secondMember: LinkedPersonMember,
    displayName: string | null = null
  ): LegacyLinkedPerson {
    let profile = this.graph.apply({
      kind: 'replace',
      members: [firstMember, secondMember],
      preferredPlatform: 'vrchat',
      defaultName: displayName ?? '',
      expectedPeople: []
    })
    if (profile === null) throw new Error('fixture link unexpectedly returned null')
    if (displayName !== null) {
      profile = this.graph.apply({
        kind: 'update',
        personId: profile.id,
        expectedRevision: profile.revision,
        patch: { customName: displayName }
      })
      if (profile === null) throw new Error('fixture name update unexpectedly returned null')
    }
    return asLegacyPerson(profile)
  }

  unlink(personId: string): LegacyLinkedPerson | null {
    const profile = this.graph.list().find((candidate) => candidate.id === personId)
    const removed = this.graph.apply({
      kind: 'unlink',
      personId,
      expectedRevision: profile?.revision ?? 1
    })
    return removed === null ? null : asLegacyPerson(removed)
  }
}

function withObjectPrototypeProperty<T>(
  key: string,
  descriptor: PropertyDescriptor,
  operation: () => T
): T {
  const original = Object.getOwnPropertyDescriptor(Object.prototype, key)
  Object.defineProperty(Object.prototype, key, descriptor)
  try {
    return operation()
  } finally {
    if (original) Object.defineProperty(Object.prototype, key, original)
    else delete (Object.prototype as Record<string, unknown>)[key]
  }
}

const vrchatA = { platform: 'vrchat' as const, platformAccountId: 'usr_a', friendId: 'usr_shared' }
const vrchatB = { platform: 'vrchat' as const, platformAccountId: 'usr_b', friendId: 'usr_shared' }
const chilloutvrA = {
  platform: 'chilloutvr' as const,
  platformAccountId: 'cvr_a',
  friendId: 'cvr_shared'
}
const chilloutvrB = {
  platform: 'chilloutvr' as const,
  platformAccountId: 'cvr_b',
  friendId: 'cvr_second'
}

describe('LinkGraphStore', () => {
  it('does no storage I/O during construction', () => {
    const storage = new MemoryLinkGraphStorage()

    new LinkGraphStore(storage)

    expect(storage.reads).toBe(0)
    expect(storage.writes).toHaveLength(0)
  })

  it('creates a complete v2 profile through apply', () => {
    const storage = new MemoryLinkGraphStorage()
    const graph = new LinkGraphStore(storage, () => 'person_v2')

    expect(
      graph.apply({
        kind: 'replace',
        members: [vrchatA, chilloutvrA],
        preferredPlatform: 'chilloutvr',
        defaultName: 'Casey',
        expectedPeople: []
      })
    ).toEqual({
      id: 'person_v2',
      members: [vrchatA, chilloutvrA],
      customName: null,
      defaultName: 'Casey',
      preferredPlatform: 'chilloutvr',
      pictureMode: 'preferred',
      sharedNote: '',
      revision: 1
    })
    expect(storage.value).toEqual({
      storeFormatVersion: 2,
      revision: expect.any(Number),
      people: {
        person_v2: {
          id: 'person_v2',
          members: [vrchatA, chilloutvrA],
          customName: null,
          defaultName: 'Casey',
          preferredPlatform: 'chilloutvr',
          pictureMode: 'preferred',
          sharedNote: '',
          revision: 1
        }
      }
    })
  })

  it('returns the existing profile for a repeated same-pair replacement without writing or generating an id', () => {
    const storage = new MemoryLinkGraphStorage()
    const createPersonId = vi.fn(() => 'person_same_pair')
    const graph = new LinkGraphStore(storage, createPersonId)
    const change: LinkChange = {
      kind: 'replace',
      members: [vrchatA, chilloutvrA],
      preferredPlatform: 'vrchat',
      defaultName: 'Alex',
      expectedPeople: []
    }
    const first = graph.apply(change)

    expect(graph.apply(change)).toEqual(first)
    expect(createPersonId).toHaveBeenCalledTimes(1)
    expect(storage.writes).toHaveLength(1)
  })

  it('rejects an unreviewed replacement that conflicts with an existing profile', () => {
    const storage = new MemoryLinkGraphStorage()
    const ids = ['person_existing', 'person_unreviewed']
    const graph = new LinkGraphStore(storage, () => ids.shift() ?? 'unexpected')
    graph.apply({
      kind: 'replace',
      members: [vrchatA, chilloutvrA],
      preferredPlatform: 'vrchat',
      defaultName: 'Alex',
      expectedPeople: []
    })

    expect(() =>
      graph.apply({
        kind: 'replace',
        members: [vrchatA, chilloutvrB],
        preferredPlatform: 'vrchat',
        defaultName: 'Alex',
        expectedPeople: []
      })
    ).toThrow(/stale/)
    expect(storage.writes).toHaveLength(1)
  })

  it('replaces two reviewed profiles in one write and leaves both unselected members unlinked', () => {
    const storage = new MemoryLinkGraphStorage()
    const ids = ['person_a', 'person_b', 'person_replacement']
    const graph = new LinkGraphStore(storage, () => ids.shift() ?? 'unexpected')
    const personA = graph.apply({
      kind: 'replace',
      members: [vrchatA, chilloutvrA],
      preferredPlatform: 'vrchat',
      defaultName: 'Alex',
      expectedPeople: []
    })!
    const personB = graph.apply({
      kind: 'replace',
      members: [vrchatB, chilloutvrB],
      preferredPlatform: 'chilloutvr',
      defaultName: 'Blair',
      expectedPeople: []
    })!
    const revisedA = graph.apply({
      kind: 'update',
      personId: personA.id,
      expectedRevision: personA.revision,
      patch: { sharedNote: 'note a' }
    })!
    const revisedB = graph.apply({
      kind: 'update',
      personId: personB.id,
      expectedRevision: personB.revision,
      patch: { sharedNote: 'note b' }
    })!
    const writesBeforeReplacement = storage.writes.length

    const replacement = graph.apply({
      kind: 'replace',
      members: [vrchatA, chilloutvrB],
      preferredPlatform: 'chilloutvr',
      defaultName: 'Casey',
      expectedPeople: [
        { id: revisedA.id, revision: revisedA.revision },
        { id: revisedB.id, revision: revisedB.revision }
      ]
    })

    expect(replacement).toMatchObject({
      id: 'person_replacement',
      members: [vrchatA, chilloutvrB],
      defaultName: 'Casey',
      preferredPlatform: 'chilloutvr',
      sharedNote: '',
      revision: 1
    })
    expect(graph.getByMember(chilloutvrA)).toBeNull()
    expect(graph.getByMember(vrchatB)).toBeNull()
    expect(graph.list()).toEqual([replacement])
    expect(storage.writes).toHaveLength(writesBeforeReplacement + 1)
  })

  it('keeps both old profiles and notes when a reviewed replacement cannot commit', () => {
    const storage = new MemoryLinkGraphStorage()
    const ids = ['person_a', 'person_b', 'person_replacement']
    const graph = new LinkGraphStore(storage, () => ids.shift() ?? 'unexpected')
    const personA = graph.apply({
      kind: 'replace',
      members: [vrchatA, chilloutvrA],
      preferredPlatform: 'vrchat',
      defaultName: 'Alex',
      expectedPeople: []
    })!
    const personB = graph.apply({
      kind: 'replace',
      members: [vrchatB, chilloutvrB],
      preferredPlatform: 'chilloutvr',
      defaultName: 'Blair',
      expectedPeople: []
    })!
    const revisedA = graph.apply({
      kind: 'update',
      personId: personA.id,
      expectedRevision: personA.revision,
      patch: { sharedNote: 'keep a' }
    })!
    const revisedB = graph.apply({
      kind: 'update',
      personId: personB.id,
      expectedRevision: personB.revision,
      patch: { sharedNote: 'keep b' }
    })!
    const before = structuredClone(storage.value)
    storage.writeError = new Error('fixture write failure')

    expect(() =>
      graph.apply({
        kind: 'replace',
        members: [vrchatA, chilloutvrB],
        preferredPlatform: 'vrchat',
        defaultName: 'Casey',
        expectedPeople: [
          { id: revisedA.id, revision: revisedA.revision },
          { id: revisedB.id, revision: revisedB.revision }
        ]
      })
    ).toThrow('fixture write failure')
    expect(storage.value).toEqual(before)
  })

  it('rejects an unlink confirmation after the shared note revision changes', () => {
    const storage = new MemoryLinkGraphStorage()
    const graph = new LinkGraphStore(storage, () => 'person_stale_note')
    const reviewed = graph.apply({
      kind: 'replace',
      members: [vrchatA, chilloutvrA],
      preferredPlatform: 'vrchat',
      defaultName: 'Alex',
      expectedPeople: []
    })!
    graph.apply({
      kind: 'update',
      personId: reviewed.id,
      expectedRevision: reviewed.revision,
      patch: { sharedNote: 'new text' }
    })

    expect(() =>
      graph.apply({
        kind: 'unlink',
        personId: reviewed.id,
        expectedRevision: reviewed.revision
      })
    ).toThrow(/stale/)
  })

  it('increments both the profile and file revision for an update', () => {
    const storage = new MemoryLinkGraphStorage()
    const graph = new LinkGraphStore(storage, () => 'person_revision')
    const created = graph.apply({
      kind: 'replace',
      members: [vrchatA, chilloutvrA],
      preferredPlatform: 'vrchat',
      defaultName: 'Alex',
      expectedPeople: []
    })!
    const beforeFileRevision = (storage.value as LinkProfileFile).revision

    const updated = graph.apply({
      kind: 'update',
      personId: created.id,
      expectedRevision: created.revision,
      patch: { pictureMode: 'merged' }
    })!

    expect(updated.revision).toBe(created.revision + 1)
    expect((storage.value as LinkProfileFile).revision).toBe(beforeFileRevision + 1)
  })

  it.each([
    ['an empty custom name', { customName: '' }],
    ['an overlength shared note', { sharedNote: 'n'.repeat(501) }]
  ] as const)('rejects %s without writing', (_case, patch) => {
    const storage = new MemoryLinkGraphStorage()
    const graph = new LinkGraphStore(storage, () => 'person_invalid_patch')
    const created = graph.apply({
      kind: 'replace',
      members: [vrchatA, chilloutvrA],
      preferredPlatform: 'vrchat',
      defaultName: 'Alex',
      expectedPeople: []
    })!
    const writesBefore = storage.writes.length

    expect(() =>
      graph.apply({
        kind: 'update',
        personId: created.id,
        expectedRevision: created.revision,
        patch
      })
    ).toThrow()
    expect(storage.writes).toHaveLength(writesBefore)
  })

  it('migrates a fully valid v1 profile once and preserves its identity and member order', () => {
    const storage = new MemoryLinkGraphStorage()
    storage.value = {
      storeFormatVersion: 1,
      people: {
        person_legacy: {
          id: 'person_legacy',
          members: [chilloutvrA, vrchatA],
          displayName: 'Legacy name'
        }
      }
    }
    const graph = new LinkGraphStore(storage)

    expect(graph.list()).toEqual([
      {
        id: 'person_legacy',
        members: [chilloutvrA, vrchatA],
        customName: 'Legacy name',
        defaultName: 'Legacy name',
        preferredPlatform: 'chilloutvr',
        pictureMode: 'preferred',
        sharedNote: '',
        revision: 1
      }
    ])
    expect(storage.backups).toBe(1)
    expect(storage.writes).toHaveLength(1)
    expect(storage.value).toMatchObject({ storeFormatVersion: 2 })

    graph.list()
    expect(storage.backups).toBe(1)
    expect(storage.writes).toHaveLength(1)
  })

  it('migrates v1 on getByMember as the first public operation', () => {
    const storage = new MemoryLinkGraphStorage()
    storage.value = {
      storeFormatVersion: 1,
      people: {
        person_legacy_lookup: {
          id: 'person_legacy_lookup',
          members: [vrchatA, chilloutvrA],
          displayName: null
        }
      }
    }
    const graph = new LinkGraphStore(storage)

    expect(graph.getByMember(vrchatA)?.id).toBe('person_legacy_lookup')
    expect(storage.backups).toBe(1)
    expect(storage.writes).toHaveLength(1)
    expect(storage.value).toMatchObject({ storeFormatVersion: 2 })
  })

  it('keeps valid v1 bytes readable and untouched when the migration backup fails', () => {
    const storage = new MemoryLinkGraphStorage()
    const legacy = {
      storeFormatVersion: 1,
      people: {
        person_legacy_failure: {
          id: 'person_legacy_failure',
          members: [vrchatA, chilloutvrA],
          displayName: null
        }
      }
    }
    storage.value = structuredClone(legacy)
    storage.backupError = new Error('backup unavailable')
    const graph = new LinkGraphStore(storage)

    expect(graph.list().map((profile) => profile.id)).toEqual(['person_legacy_failure'])
    expect(storage.value).toEqual(legacy)
    expect(storage.writes).toHaveLength(0)
  })

  it('does not invoke an accessor-backed v2 command before rejecting it', () => {
    const storage = new MemoryLinkGraphStorage()
    const graph = new LinkGraphStore(storage, () => 'person_accessor_command')
    let reads = 0
    const change = {
      members: [vrchatA, chilloutvrA],
      preferredPlatform: 'vrchat',
      defaultName: 'Alex',
      expectedPeople: []
    }
    Object.defineProperty(change, 'kind', {
      enumerable: true,
      get() {
        reads += 1
        return 'replace'
      }
    })

    expect(() => graph.apply(change as unknown as LinkChange)).toThrow(/invalid/)
    expect(reads).toBe(0)
    expect(storage.writes).toHaveLength(0)
  })

  it('does not invoke an accessor-backed v2 file revision before rejecting it', () => {
    const storage = new MemoryLinkGraphStorage()
    let reads = 0
    const value = { storeFormatVersion: 2, people: {} }
    Object.defineProperty(value, 'revision', {
      enumerable: true,
      get() {
        reads += 1
        return 1
      }
    })
    storage.value = value
    const graph = new LinkGraphStore(storage, () => 'person_after_accessor_file')

    expect(graph.list()).toEqual([])
    expect(reads).toBe(0)
    expect(() =>
      graph.apply({
        kind: 'replace',
        members: [vrchatA, chilloutvrA],
        preferredPlatform: 'vrchat',
        defaultName: 'Alex',
        expectedPeople: []
      })
    ).toThrow()
    expect(reads).toBe(0)
    expect(storage.writes).toHaveLength(0)
  })

  it('keeps identical upstream friend ids from distinct accounts as separate members', () => {
    const storage = new MemoryLinkGraphStorage()
    const ids = ['person_a', 'person_b']
    const store = new FixtureLinkGraphStore(storage, () => ids.shift() ?? 'unexpected')

    store.link(vrchatA, chilloutvrA)
    store.link(vrchatB, chilloutvrB)

    expect(store.list()).toEqual([
      {
        id: 'person_a',
        members: [vrchatA, chilloutvrA],
        displayName: null
      },
      {
        id: 'person_b',
        members: [vrchatB, chilloutvrB],
        displayName: null
      }
    ])
  })

  it('round-trips a link through a new store instance', () => {
    const storage = new MemoryLinkGraphStorage()
    const writer = new FixtureLinkGraphStore(storage, () => 'person_roundtrip')
    const expected: LegacyLinkedPerson = {
      id: 'person_roundtrip',
      members: [vrchatA, chilloutvrA],
      displayName: 'Alex'
    }

    expect(writer.link(vrchatA, chilloutvrA, 'Alex')).toEqual(expected)

    const reader = new FixtureLinkGraphStore(storage)
    expect(reader.list()).toEqual([expected])
    expect(reader.getByMember(vrchatA)).toEqual(expected)
  })

  it('rejects a link with two members from the same platform without persisting it', () => {
    const storage = new MemoryLinkGraphStorage()
    const store = new FixtureLinkGraphStore(storage, () => 'person_same_platform')

    expect(() => store.link(vrchatA, vrchatB)).toThrow('one member per platform')
    expect(storage.writes).toHaveLength(0)
  })

  it('rejects a conflicting fixture link as stale without persisting a second person', () => {
    const storage = new MemoryLinkGraphStorage()
    const ids = ['person_first', 'person_second']
    const store = new FixtureLinkGraphStore(storage, () => ids.shift() ?? 'unexpected')
    store.link(vrchatA, chilloutvrA)

    expect(() => store.link(vrchatA, chilloutvrB)).toThrow(/stale/)
    expect(store.list()).toHaveLength(1)
    expect(storage.writes).toHaveLength(1)
  })

  it('unlinks only graph references and returns the removed person losslessly', () => {
    const storage = new MemoryLinkGraphStorage()
    const store = new FixtureLinkGraphStore(storage, () => 'person_unlink')
    const person = store.link(vrchatA, chilloutvrA)

    expect(store.unlink(person.id)).toEqual(person)
    expect(store.getByMember(vrchatA)).toBeNull()
    expect(store.getByMember(chilloutvrA)).toBeNull()
    expect(store.list()).toEqual([])
  })

  it('fails closed on corrupt storage and does not overwrite it', () => {
    const storage = new MemoryLinkGraphStorage()
    storage.value = { storeFormatVersion: LINK_GRAPH_FORMAT_VERSION, people: [] }
    const store = new FixtureLinkGraphStore(storage, () => 'person_corrupt')

    expect(store.list()).toEqual([])
    expect(() => store.link(vrchatA, chilloutvrA)).toThrow('storage could not be loaded')
    expect(storage.writes).toHaveLength(0)
  })

  it.each([
    [
      'corrupt',
      { storeFormatVersion: LINK_GRAPH_FORMAT_VERSION, people: [] },
      'storage could not be loaded'
    ],
    ['future', { storeFormatVersion: 999, people: {} }, 'written by a newer version']
  ] as const)(
    'fails closed instead of reporting a missing unlink when storage is %s',
    (_kind, value, expectedError) => {
      const storage = new MemoryLinkGraphStorage()
      storage.value = value
      const store = new FixtureLinkGraphStore(storage)

      expect(() => store.unlink('person_maybe_present')).toThrow(expectedError)
      expect(storage.writes).toHaveLength(0)
    }
  )

  it('refuses to overwrite a graph written by a newer build', () => {
    const storage = new MemoryLinkGraphStorage()
    storage.value = { storeFormatVersion: 999, people: {}, futureField: 'preserve' }
    const store = new FixtureLinkGraphStore(storage, () => 'person_future')

    expect(() => store.link(vrchatA, chilloutvrA)).toThrow('written by a newer version')
    expect(storage.writes).toHaveLength(0)
  })

  it('fails closed instead of dropping an own __proto__ persisted person', () => {
    const storage = new MemoryLinkGraphStorage()
    storage.value = JSON.parse(`{
      "storeFormatVersion": 1,
      "people": {
        "__proto__": {
          "id": "__proto__",
          "members": [
            { "platform": "vrchat", "platformAccountId": "usr_a", "friendId": "usr_shared" },
            { "platform": "chilloutvr", "platformAccountId": "cvr_a", "friendId": "cvr_shared" }
          ],
          "displayName": null
        }
      }
    }`)
    const store = new FixtureLinkGraphStore(storage, () => 'person_after_corruption')

    expect(store.list()).toEqual([])
    expect(() => store.link(vrchatA, chilloutvrA)).toThrow('storage could not be loaded')
    expect(storage.writes).toHaveLength(0)
  })

  it('rejects a prototype-dangerous generated person id without persisting', () => {
    const storage = new MemoryLinkGraphStorage()
    const store = new FixtureLinkGraphStore(storage, () => '__proto__')

    expect(() => store.link(vrchatA, chilloutvrA)).toThrow(/invalid person id/)
    expect(storage.writes).toHaveLength(0)
  })

  it.each(['toString', 'valueOf', 'hasOwnProperty', '__defineGetter__'])(
    'creates and removes a schema-valid person id named %s',
    (personId) => {
      const storage = new MemoryLinkGraphStorage()
      const store = new FixtureLinkGraphStore(storage, () => personId)

      const person = store.link(vrchatA, chilloutvrA)

      expect(person.id).toBe(personId)
      expect(store.unlink(personId)).toEqual(person)
      expect(store.list()).toEqual([])
    }
  )

  it.each(['toString', 'valueOf', 'hasOwnProperty', '__defineGetter__'])(
    'does not treat inherited Object.prototype name %s as an existing person',
    (personId) => {
      const storage = new MemoryLinkGraphStorage()
      const store = new FixtureLinkGraphStore(storage)

      expect(() => store.unlink(personId)).toThrow(/stale/)
      expect(storage.writes).toHaveLength(0)
    }
  )

  it('rejects an accessor-backed caller member without invoking it when linking', () => {
    const storage = new MemoryLinkGraphStorage()
    let platformReads = 0
    const adversarialMember = {
      get platform(): 'vrchat' | 'chilloutvr' {
        platformReads += 1
        return platformReads <= 2 ? 'vrchat' : 'chilloutvr'
      },
      platformAccountId: 'usr_a',
      friendId: 'usr_adversarial'
    }
    const store = new FixtureLinkGraphStore(storage, () => 'person_snapshot')

    expect(() => store.link(adversarialMember, chilloutvrA)).toThrow(/invalid/)
    expect(platformReads).toBe(0)
    expect(storage.writes).toHaveLength(0)
  })

  it('rejects an accessor-backed caller member without invoking it when looking up a link', () => {
    const storage = new MemoryLinkGraphStorage()
    const store = new FixtureLinkGraphStore(storage, () => 'person_lookup')
    store.link(vrchatA, chilloutvrA)
    let platformReads = 0
    const adversarialLookup = {
      get platform(): 'vrchat' | 'chilloutvr' {
        platformReads += 1
        return platformReads === 1 ? 'vrchat' : 'chilloutvr'
      },
      platformAccountId: 'usr_a',
      friendId: 'usr_shared'
    }

    expect(() => store.getByMember(adversarialLookup)).toThrow('invalid member')
    expect(platformReads).toBe(0)
  })

  it('does not depend on the active-account epoch to preserve installation-global links', () => {
    const storage = new MemoryLinkGraphStorage()
    const writer = new FixtureLinkGraphStore(storage, () => 'person_global')
    writer.link(vrchatA, chilloutvrA)

    const storeAfterAccountChange = new FixtureLinkGraphStore(storage)
    expect(storeAfterAccountChange.getByMember(vrchatA)?.id).toBe('person_global')
  })

  it('refreshes list and getByMember from another live store instance', () => {
    const storage = new MemoryLinkGraphStorage()
    const writer = new FixtureLinkGraphStore(storage, () => 'person_writer')
    const reader = new FixtureLinkGraphStore(storage, () => 'person_reader')

    writer.link(vrchatA, chilloutvrA)

    expect(reader.list()).toEqual([
      { id: 'person_writer', members: [vrchatA, chilloutvrA], displayName: null }
    ])
    expect(reader.getByMember(vrchatA)?.id).toBe('person_writer')
  })

  it('preserves sequential links made through two live store instances', () => {
    const storage = new MemoryLinkGraphStorage()
    const first = new FixtureLinkGraphStore(storage, () => 'person_first')
    const second = new FixtureLinkGraphStore(storage, () => 'person_second')

    first.link(vrchatA, chilloutvrA)
    second.link(vrchatB, chilloutvrB)

    expect(new FixtureLinkGraphStore(storage).list().map((person) => person.id)).toEqual([
      'person_first',
      'person_second'
    ])
  })

  it('preserves another instance’s link when unlinking after its write', () => {
    const storage = new MemoryLinkGraphStorage()
    const first = new FixtureLinkGraphStore(storage, () => 'person_first')
    const second = new FixtureLinkGraphStore(storage, () => 'person_second')
    first.link(vrchatA, chilloutvrA)
    second.link(vrchatB, chilloutvrB)

    first.unlink('person_first')

    expect(new FixtureLinkGraphStore(storage).list()).toEqual([
      { id: 'person_second', members: [vrchatB, chilloutvrB], displayName: null }
    ])
  })

  it('refreshes duplicate-id and capacity decisions before linking', () => {
    const storage = new MemoryLinkGraphStorage()
    const first = new FixtureLinkGraphStore(storage, () => 'person_duplicate')
    const duplicateId = new FixtureLinkGraphStore(storage, () => 'person_duplicate')
    first.link(vrchatA, chilloutvrA)

    expect(() => duplicateId.link(vrchatB, chilloutvrB)).toThrow('generated a duplicate person id')

    const fullPeople = Object.fromEntries(
      Array.from({ length: 5_000 }, (_, index) => [
        `person_${index}`,
        {
          id: `person_${index}`,
          members: [
            { platform: 'vrchat', platformAccountId: `usr_${index}`, friendId: `friend_${index}` },
            {
              platform: 'chilloutvr',
              platformAccountId: `cvr_${index}`,
              friendId: `cvr_friend_${index}`
            }
          ],
          displayName: null
        }
      ])
    )
    const capped = new FixtureLinkGraphStore(storage, () => 'person_over_capacity')
    storage.value = { storeFormatVersion: LINK_GRAPH_FORMAT_VERSION, people: fullPeople }

    expect(() => capped.link(vrchatA, chilloutvrA)).toThrow('maximum linked people reached')
  })

  it.each([
    [
      'corrupt',
      { storeFormatVersion: LINK_GRAPH_FORMAT_VERSION, people: [] },
      'storage could not be loaded'
    ],
    ['future', { storeFormatVersion: 999, people: {} }, 'written by a newer version']
  ] as const)(
    'fails closed without overwrite when another instance replaces storage with %s data',
    (_kind, replacement, expectedError) => {
      const storage = new MemoryLinkGraphStorage()
      const stale = new FixtureLinkGraphStore(storage, () => 'person_stale')
      storage.value = replacement

      expect(() => stale.link(vrchatA, chilloutvrA)).toThrow(expectedError)
      expect(storage.writes).toHaveLength(0)
    }
  )

  it('does not retain a stale graph after a write failure', () => {
    const storage = new MemoryLinkGraphStorage()
    const stale = new FixtureLinkGraphStore(storage, () => 'person_failed')
    const writer = new FixtureLinkGraphStore(storage, () => 'person_external')
    writer.link(vrchatA, chilloutvrA)
    storage.writeError = new Error('disk unavailable')

    expect(() => stale.link(vrchatB, chilloutvrB)).toThrow('disk unavailable')

    storage.writeError = null
    expect(stale.list()).toEqual([
      { id: 'person_external', members: [vrchatA, chilloutvrA], displayName: null }
    ])
    stale.link(vrchatB, chilloutvrB)
    expect(new FixtureLinkGraphStore(storage).list().map((person) => person.id)).toEqual([
      'person_external',
      'person_failed'
    ])
  })

  it('does not overwrite a future graph installed by the person-id callback', () => {
    const storage = new MemoryLinkGraphStorage()
    const store = new FixtureLinkGraphStore(storage, () => {
      storage.value = { storeFormatVersion: 999, people: {} }
      return 'person_outer'
    })

    expect(() => store.link(vrchatA, chilloutvrA)).toThrow('written by a newer version')
    expect(storage.writes).toHaveLength(0)
    expect(storage.value).toEqual({ storeFormatVersion: 999, people: {} })
  })

  it('rejects another store’s link created by the person-id callback', () => {
    const storage = new MemoryLinkGraphStorage()
    const inner = new FixtureLinkGraphStore(storage, () => 'person_inner')
    let linked = false
    let reentryError: unknown
    const outer = new FixtureLinkGraphStore(storage, () => {
      if (!linked) {
        linked = true
        try {
          inner.link(vrchatB, chilloutvrB)
        } catch (error) {
          reentryError = error
        }
      }
      return 'person_outer'
    })

    outer.link(vrchatA, chilloutvrA)

    expect(reentryError).toEqual(new Error('link graph: reentrant operation rejected'))
    expect(new FixtureLinkGraphStore(storage).list().map((person) => person.id)).toEqual([
      'person_outer'
    ])
  })

  it('rejects same-store reentry from createPersonId and recovers for later calls', () => {
    const storage = new MemoryLinkGraphStorage()
    const holder: { store: FixtureLinkGraphStore | null } = { store: null }
    let reentryError: unknown
    let called = false
    const store = new FixtureLinkGraphStore(storage, () => {
      if (!called) {
        called = true
        try {
          holder.store?.link(vrchatA, chilloutvrA)
        } catch (error) {
          reentryError = error
        }
        return 'person_guarded'
      }
      return 'person_after_guard'
    })
    holder.store = store

    expect(store.link(vrchatA, chilloutvrA).id).toBe('person_guarded')
    expect(reentryError).toEqual(new Error('link graph: reentrant operation rejected'))
    expect(store.link(vrchatB, chilloutvrB).id).toBe('person_after_guard')
  })

  it('rejects cross-instance reads and writes reentered from storage.write, then recovers', () => {
    const storage = new MemoryLinkGraphStorage()
    const first = new FixtureLinkGraphStore(storage, () => 'person_outer')
    const second = new FixtureLinkGraphStore(storage, () => 'person_inner')
    const originalWrite = storage.write.bind(storage)
    const errors: unknown[] = []
    let reentered = false
    storage.write = (value) => {
      if (!reentered) {
        reentered = true
        for (const operation of [
          () => second.list(),
          () => second.getByMember(vrchatA),
          () => second.link(vrchatB, chilloutvrB),
          () => first.unlink('person_outer')
        ]) {
          try {
            operation()
          } catch (error) {
            errors.push(error)
          }
        }
      }
      originalWrite(value)
    }

    expect(first.link(vrchatA, chilloutvrA).id).toBe('person_outer')
    expect(errors).toEqual([
      new Error('link graph: reentrant operation rejected'),
      new Error('link graph: reentrant operation rejected'),
      new Error('link graph: reentrant operation rejected'),
      new Error('link graph: reentrant operation rejected')
    ])
    expect(storage.writes).toHaveLength(1)
    expect(second.link(vrchatB, chilloutvrB).id).toBe('person_inner')
    expect(new FixtureLinkGraphStore(storage).list().map((person) => person.id)).toEqual([
      'person_inner',
      'person_outer'
    ])
  })

  it('rejects a lookup member getter before it can unlink another store record', () => {
    const storage = new MemoryLinkGraphStorage()
    const writer = new FixtureLinkGraphStore(storage, () => 'person_lookup')
    writer.link(vrchatA, chilloutvrA)
    const reader = new FixtureLinkGraphStore(storage)
    const remover = new FixtureLinkGraphStore(storage)
    let removed = false
    const member = {
      get platform(): 'vrchat' {
        if (!removed) {
          removed = true
          remover.unlink('person_lookup')
        }
        return 'vrchat'
      },
      platformAccountId: 'usr_a',
      friendId: 'usr_shared'
    }

    expect(() => reader.getByMember(member)).toThrow('invalid member')
    expect(removed).toBe(false)
    expect(reader.list()).toHaveLength(1)
  })

  it('fails closed when storeFormatVersion exists only on the root prototype', () => {
    const storage = new MemoryLinkGraphStorage()
    storage.value = Object.assign(Object.create({ storeFormatVersion: 1 }), { people: {} })
    const store = new FixtureLinkGraphStore(storage, () => 'person_inherited_root')

    expect(store.list()).toEqual([])
    expect(() => store.link(vrchatA, chilloutvrA)).toThrow('storage could not be loaded')
    expect(storage.writes).toHaveLength(0)
  })

  it('fails closed when a person inherits displayName', () => {
    const storage = new MemoryLinkGraphStorage()
    const person = Object.assign(Object.create({ displayName: null }), {
      id: 'person_inherited_display',
      members: [vrchatA, chilloutvrA]
    })
    storage.value = { storeFormatVersion: 1, people: { person_inherited_display: person } }
    const store = new FixtureLinkGraphStore(storage, () => 'person_after_inherited_display')

    expect(store.list()).toEqual([])
    expect(() => store.link(vrchatB, chilloutvrB)).toThrow('storage could not be loaded')
    expect(storage.writes).toHaveLength(0)
  })

  it('fails closed when a member inherits friendId', () => {
    const storage = new MemoryLinkGraphStorage()
    const inheritedFriend = Object.assign(Object.create({ friendId: 'usr_inherited' }), {
      platform: 'vrchat',
      platformAccountId: 'usr_a'
    })
    storage.value = {
      storeFormatVersion: 1,
      people: {
        person_inherited_member: {
          id: 'person_inherited_member',
          members: [inheritedFriend, chilloutvrA],
          displayName: null
        }
      }
    }
    const store = new FixtureLinkGraphStore(storage, () => 'person_after_inherited_member')

    expect(store.list()).toEqual([])
    expect(() => store.link(vrchatB, chilloutvrB)).toThrow('storage could not be loaded')
    expect(storage.writes).toHaveLength(0)
  })

  it('never invokes an accessor-backed root people property before rejecting it', () => {
    const storage = new MemoryLinkGraphStorage()
    let reads = 0
    const accessorRoot = { storeFormatVersion: 1 }
    Object.defineProperty(accessorRoot, 'people', {
      enumerable: true,
      get() {
        reads += 1
        storage.value = { storeFormatVersion: 999, people: {} }
        return {}
      }
    })
    storage.value = accessorRoot
    const store = new FixtureLinkGraphStore(storage, () => 'person_accessor_root')

    expect(reads).toBe(0)
    expect(store.list()).toEqual([])
    expect(reads).toBe(0)
    expect(() => store.link(vrchatA, chilloutvrA)).toThrow('storage could not be loaded')
    expect(reads).toBe(0)
    expect(storage.writes).toHaveLength(0)

    storage.value = {}
    expect(store.link(vrchatA, chilloutvrA).id).toBe('person_accessor_root')
  })

  it.each([
    [
      'person accessor',
      () => {
        const person = { id: 'person_accessor', members: [vrchatA, chilloutvrA] }
        Object.defineProperty(person, 'displayName', { enumerable: true, get: () => null })
        return { storeFormatVersion: 1, people: { person_accessor: person } }
      }
    ],
    [
      'member accessor',
      () => {
        const member = { platform: 'vrchat', platformAccountId: 'usr_a' }
        Object.defineProperty(member, 'friendId', { enumerable: true, get: () => 'usr_accessor' })
        return {
          storeFormatVersion: 1,
          people: {
            person_member_accessor: {
              id: 'person_member_accessor',
              members: [member, chilloutvrA],
              displayName: null
            }
          }
        }
      }
    ],
    [
      'proxy member',
      () => ({
        storeFormatVersion: 1,
        people: {
          person_proxy: {
            id: 'person_proxy',
            members: [new Proxy(vrchatA, {}), chilloutvrA],
            displayName: null
          }
        }
      })
    ],
    [
      'sparse member tuple',
      () => {
        const members = new Array(2)
        members[0] = vrchatA
        return {
          storeFormatVersion: 1,
          people: { person_sparse: { id: 'person_sparse', members, displayName: null } }
        }
      }
    ]
  ] as const)('fails closed for non-canonical nested %s', (_kind, createValue) => {
    const storage = new MemoryLinkGraphStorage()
    storage.value = createValue()
    const store = new FixtureLinkGraphStore(storage, () => 'person_nested_recovery')

    expect(store.list()).toEqual([])
    expect(() => store.link(vrchatB, chilloutvrB)).toThrow('storage could not be loaded')
    expect(storage.writes).toHaveLength(0)
  })

  it('preserves caller member data despite a non-writable Object.prototype friendId', () => {
    withObjectPrototypeProperty(
      'friendId',
      { value: 'prototype_friend', writable: false, configurable: true },
      () => {
        const storage = new MemoryLinkGraphStorage()
        const store = new FixtureLinkGraphStore(storage, () => 'person_prototype_friend')

        const person = store.link(vrchatA, chilloutvrA)

        expect(person.members[0].friendId).toBe('usr_shared')
        const persisted = storage.writes.at(-1)
        expect(persisted?.people.person_prototype_friend?.members[0].friendId).toBe('usr_shared')
      }
    )
  })

  it('preserves an existing toString-keyed person despite a non-writable Object.prototype name', () => {
    withObjectPrototypeProperty(
      'toString',
      { value: Object.prototype.toString, writable: false, configurable: true },
      () => {
        const storage = new MemoryLinkGraphStorage()
        storage.value = {
          storeFormatVersion: 1,
          people: {
            toString: { id: 'toString', members: [vrchatA, chilloutvrA], displayName: null }
          }
        }
        const store = new FixtureLinkGraphStore(storage)

        expect(store.list()[0]?.id).toBe('toString')
        expect(store.getByMember(vrchatA)?.id).toBe('toString')
      }
    )
  })

  it('fails closed when an inherited members tuple could mask own same-platform members', () => {
    withObjectPrototypeProperty(
      'members',
      { value: [vrchatA, chilloutvrA], writable: false, configurable: true },
      () => {
        const storage = new MemoryLinkGraphStorage()
        storage.value = {
          storeFormatVersion: 1,
          people: {
            person_masked_members: {
              id: 'person_masked_members',
              members: [vrchatA, vrchatB],
              displayName: null
            }
          }
        }
        const store = new FixtureLinkGraphStore(storage, () => 'person_after_masked_members')

        expect(store.list()).toEqual([])
        expect(() => store.link(vrchatA, chilloutvrA)).toThrow('storage could not be loaded')
        expect(storage.writes).toHaveLength(0)
      }
    )
  })

  it('rejects descriptor-shaped inherited root version instead of treating an unexpected own key as it', () => {
    withObjectPrototypeProperty(
      'storeFormatVersion',
      { value: { value: 999 }, writable: false, configurable: true },
      () => {
        const storage = new MemoryLinkGraphStorage()
        storage.value = { people: {}, unexpected: true }
        const store = new FixtureLinkGraphStore(storage, () => 'person_descriptor_root')

        expect(store.list()).toEqual([])
        expect(() => store.link(vrchatA, chilloutvrA)).toThrow('storage could not be loaded')
        expect(storage.writes).toHaveLength(0)
      }
    )
  })

  it('never invokes an inherited storeFormatVersion accessor', () => {
    let reads = 0
    withObjectPrototypeProperty(
      'storeFormatVersion',
      {
        configurable: true,
        get() {
          reads += 1
          return { value: 999 }
        }
      },
      () => {
        const storage = new MemoryLinkGraphStorage()
        storage.value = { people: {} }
        const store = new FixtureLinkGraphStore(storage, () => 'person_accessor_version')

        expect(store.list()).toEqual([])
        expect(() => store.link(vrchatA, chilloutvrA)).toThrow('storage could not be loaded')
        expect(reads).toBe(0)
        expect(storage.writes).toHaveLength(0)
      }
    )
  })

  it.each([
    [
      'person displayName',
      'displayName',
      () => ({
        storeFormatVersion: 1,
        people: {
          person_descriptor_display: {
            id: 'person_descriptor_display',
            members: [vrchatA, chilloutvrA],
            extra: true
          }
        }
      })
    ],
    [
      'member friendId',
      'friendId',
      () => ({
        storeFormatVersion: 1,
        people: {
          person_descriptor_friend: {
            id: 'person_descriptor_friend',
            members: [{ platform: 'vrchat', platformAccountId: 'usr_a', extra: true }, chilloutvrA],
            displayName: null
          }
        }
      })
    ],
    [
      'member platform',
      'platform',
      () => ({
        storeFormatVersion: 1,
        people: {
          person_descriptor_platform: {
            id: 'person_descriptor_platform',
            members: [
              { platformAccountId: 'usr_a', friendId: 'usr_shared', extra: true },
              chilloutvrA
            ],
            displayName: null
          }
        }
      })
    ],
    [
      'member platformAccountId',
      'platformAccountId',
      () => ({
        storeFormatVersion: 1,
        people: {
          person_descriptor_account: {
            id: 'person_descriptor_account',
            members: [{ platform: 'vrchat', friendId: 'usr_shared', extra: true }, chilloutvrA],
            displayName: null
          }
        }
      })
    ],
    [
      'person id',
      'id',
      () => ({
        storeFormatVersion: 1,
        people: {
          person_descriptor_id: { members: [vrchatA, chilloutvrA], displayName: null, extra: true }
        }
      })
    ],
    ['root people', 'people', () => ({ storeFormatVersion: 1, unexpected: true })]
  ] as const)('rejects descriptor-shaped inherited %s', (_kind, key, createValue) => {
    withObjectPrototypeProperty(
      key,
      {
        value: {
          value: key === 'platform' ? 'vrchat' : key === 'displayName' ? null : 'usr_shared'
        },
        configurable: true
      },
      () => {
        const storage = new MemoryLinkGraphStorage()
        storage.value = createValue()
        const store = new FixtureLinkGraphStore(storage, () => 'person_descriptor_nested')

        expect(store.list()).toEqual([])
        expect(() => store.link(vrchatB, chilloutvrB)).toThrow('storage could not be loaded')
        expect(storage.writes).toHaveLength(0)
      }
    )
  })

  it('rejects a sparse tuple whose missing index exists only on Object.prototype', () => {
    withObjectPrototypeProperty('1', { value: { value: chilloutvrA }, configurable: true }, () => {
      const members = new Array(2)
      members[0] = vrchatA
      Object.defineProperty(members, 'extra', { value: true, enumerable: true })
      const storage = new MemoryLinkGraphStorage()
      storage.value = {
        storeFormatVersion: 1,
        people: {
          person_sparse_prototype: { id: 'person_sparse_prototype', members, displayName: null }
        }
      }
      const store = new FixtureLinkGraphStore(storage, () => 'person_sparse_after')

      expect(store.list()).toEqual([])
      expect(() => store.link(vrchatB, chilloutvrB)).toThrow()
      expect(storage.writes).toHaveLength(0)
    })
  })
})
