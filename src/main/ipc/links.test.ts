import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountSession } from '../services/accountSession'
import { LocationAuthority } from '../services/locationAuthority'
import { fullFriend } from '../../renderer/src/test-utils/friendFixture'
import { LinkGraphStore, type LinkGraphStorage } from '../services/linkGraphStore'
import { registerLinksHandlers } from './links'
import type { LinkSnapshot } from '@shared/linkedProfiles'

const { handlers, trusted } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  trusted: vi.fn(() => true)
}))
vi.mock('electron', () => ({
  ipcMain: { handle: (name: string, fn: (...args: unknown[]) => unknown) => handlers.set(name, fn) }
}))
vi.mock('./security', () => ({ isTrustedIpcSender: trusted }))
const vrc = { platform: 'vrchat' as const, friendId: 'friend_vrc' }
const cvr = { platform: 'chilloutvr' as const, friendId: 'friend_cvr' }
function invoke(
  name: string,
  request?: unknown
): { ok: boolean; value: LinkSnapshot; reason?: string } {
  // Test captures Electron's dynamically registered callbacks.
  return handlers.get(name)!({ senderFrame: {} }, request) as ReturnType<typeof invoke>
}
beforeEach(() => {
  handlers.clear()
  trusted.mockReturnValue(true)
})
function setup(locationAuthority?: LocationAuthority): {
  session: AccountSession
  graph: LinkGraphStore
  storage: LinkGraphStorage
  changed: ReturnType<typeof vi.fn>
} {
  let data: unknown = {}
  const storage: LinkGraphStorage = {
    read: () => data,
    write: (value) => {
      data = structuredClone(value)
    }
  }
  const session = new AccountSession()
  session.setIdentity('vrchat', 'owner_vrc')
  session.setIdentity('chilloutvr', 'owner_cvr')
  const graph = new LinkGraphStore(storage, () => 'person')
  const changed = vi.fn()
  registerLinksHandlers({
    accountSession: session,
    linkGraph: graph,
    onChanged: changed,
    locationAuthority
  })
  return { session, graph, storage, changed }
}
function create(): ReturnType<typeof invoke> {
  const read = invoke('get-linked-profiles')
  return invoke('change-linked-profile', {
    lease: read.value.lease,
    change: {
      kind: 'replace',
      members: [vrc, cvr],
      preferredPlatform: 'vrchat',
      defaultName: 'Alex',
      expectedPeople: []
    }
  })
}
describe('scoped linked profile IPC', () => {
  it.each(['read-only disk', 'full disk'])(
    'keeps saved profiles readable when a background name refresh fails on %s',
    (failure) => {
      const authority = new LocationAuthority()
      const { storage, changed } = setup(authority)
      const saved = create().value
      const before = structuredClone(storage.read())
      changed.mockClear()
      storage.write = () => {
        throw new Error(failure)
      }
      authority.consume({ type: 'connection', platform: 'vrchat', health: 'live' })
      authority.seed(
        'vrchat',
        [{ ...fullFriend('Fresh name', 'vrchat'), platformUserId: vrc.friendId }],
        authority.captureSeedRevision('vrchat')
      )
      expect(invoke('get-linked-profiles')).toEqual({ ok: true, value: saved })
      expect(storage.read()).toEqual(before)
      expect(changed).not.toHaveBeenCalled()
    }
  )
  it('publishes only current main-owned account scopes with every leased snapshot', () => {
    const { session } = setup()
    const initial = create().value
    expect(initial).toHaveProperty('accountIds', {
      vrchat: 'owner_vrc',
      chilloutvr: 'owner_cvr'
    })
    expect(invoke('get-linked-profiles').value).toEqual(initial)
    session.setIdentity('vrchat', null)
    const signedOut = invoke('get-linked-profiles').value
    expect(signedOut).toHaveProperty('accountIds', { chilloutvr: 'owner_cvr' })
    expect(signedOut.lease).not.toBe(initial.lease)
    session.setIdentity('vrchat', 'replacement_owner')
    expect(invoke('get-linked-profiles').value).toHaveProperty('accountIds', {
      vrchat: 'replacement_owner',
      chilloutvr: 'owner_cvr'
    })
  })
  it('persists only fresh preferred names from the matching main-owned account scope', () => {
    const authority = new LocationAuthority()
    const { session, graph } = setup(authority)
    create()
    const friend = { ...fullFriend('Renamed', 'vrchat'), platformUserId: vrc.friendId }
    authority.consume({ type: 'connection', platform: 'vrchat', health: 'live' })
    authority.seed('vrchat', [friend], authority.captureSeedRevision('vrchat'))
    const updated = invoke('get-linked-profiles').value
    expect(updated.profiles[0]?.defaultName).toBe('Renamed')
    expect(graph.snapshot().profiles[0]?.defaultName).toBe('Renamed')
    const revision = updated.storeRevision
    authority.clearPlatform('vrchat')
    expect(invoke('get-linked-profiles').value.storeRevision).toBe(revision)
    session.setIdentity('vrchat', 'another_owner')
    authority.consume({ type: 'connection', platform: 'vrchat', health: 'live' })
    authority.seed(
      'vrchat',
      [{ ...friend, displayName: 'Other account name' }],
      authority.captureSeedRevision('vrchat')
    )
    expect(invoke('get-linked-profiles').value.profiles[0]?.defaultName).toBe('Renamed')
  })
  it('publishes monotonic document revisions without rotating a healthy session lease', () => {
    setup()
    const before = invoke('get-linked-profiles').value
    const after = create().value
    expect(after.lease).toBe(before.lease)
    expect(after.storeRevision).toBe(before.storeRevision + 1)
    expect(invoke('get-linked-profiles').value).toEqual(after)
  })
  it('returns the committed snapshot even when a later read fails', () => {
    const { storage, changed } = setup()
    changed.mockImplementation(() => {
      storage.read = () => {
        throw new Error('read failure')
      }
    })
    const result = create()
    expect(result.ok).toBe(true)
    expect(result.value.profiles[0]?.revision).toBe(1)
  })
  it('qualifies both selected identities in main and publishes successful changes', () => {
    const { changed } = setup()
    const result = create()
    expect(result.ok).toBe(true)
    expect(result.value.profiles[0]?.members).toEqual([
      { ...vrc, platformAccountId: 'owner_vrc' },
      { ...cvr, platformAccountId: 'owner_cvr' }
    ])
    expect(changed).toHaveBeenCalledTimes(1)
  })
  it('checks sender trust before reading or writing', () => {
    const { storage } = setup()
    trusted.mockReturnValue(false)
    expect(() => invoke('get-linked-profiles')).toThrow('Untrusted IPC sender')
    expect(() => invoke('change-linked-profile', {})).toThrow('Untrusted IPC sender')
    expect(storage.read()).toEqual({})
  })
  it('rejects an old lease after logout and relogin to the same account', () => {
    const { session, storage } = setup()
    const result = create()
    const before = structuredClone(storage.read())
    session.setIdentity('vrchat', null)
    session.setIdentity('vrchat', 'owner_vrc')
    expect(
      invoke('change-linked-profile', {
        lease: result.value.lease,
        change: { kind: 'unlink', personId: 'person', expectedRevision: 1 }
      })
    ).toEqual({ ok: false, reason: 'stale' })
    expect(storage.read()).toEqual(before)
  })
  it('keeps a healthy anchor and permits unlink while the other account is unavailable', () => {
    const { session, graph } = setup()
    create()
    session.setIdentity('chilloutvr', null)
    const read = invoke('get-linked-profiles')
    expect(read.value.profiles).toHaveLength(1)
    expect(
      invoke('change-linked-profile', {
        lease: read.value.lease,
        change: { kind: 'unlink', personId: 'person', expectedRevision: 1 }
      }).ok
    ).toBe(true)
    expect(graph.list()).toEqual([])
  })
  it('hides profiles after both identities change without deleting durable data', () => {
    const { session, storage } = setup()
    create()
    const before = structuredClone(storage.read())
    session.setIdentity('vrchat', 'other_vrc')
    session.setIdentity('chilloutvr', 'other_cvr')
    const read = invoke('get-linked-profiles')
    expect(read.value.profiles).toEqual([])
    expect(
      invoke('change-linked-profile', {
        lease: read.value.lease,
        change: { kind: 'unlink', personId: 'person', expectedRevision: 1 }
      })
    ).toEqual({ ok: false, reason: 'unavailable' })
    expect(storage.read()).toEqual(before)
  })
  it.each([
    { ...vrc, platformAccountId: 'forged' },
    { ...vrc, friendId: '../bad' },
    { ...vrc, platform: 'unknown' }
  ])('rejects a forged or malformed friend selection', (member) => {
    const { storage } = setup()
    const read = invoke('get-linked-profiles')
    expect(
      invoke('change-linked-profile', {
        lease: read.value.lease,
        change: {
          kind: 'replace',
          members: [member, cvr],
          preferredPlatform: 'vrchat',
          defaultName: 'A',
          expectedPeople: []
        }
      })
    ).toEqual({ ok: false, reason: 'invalid' })
    expect(storage.read()).toEqual({})
  })
  it('does not create links with a missing platform login', () => {
    const { session, storage } = setup()
    session.setIdentity('chilloutvr', null)
    expect(create()).toEqual({ ok: false, reason: 'unavailable' })
    expect(storage.read()).toEqual({})
  })
})
