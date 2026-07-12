import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountSession } from './accountSession'
import {
  ACCOUNT_REGISTRY_FORMAT_VERSION,
  AccountRegistry,
  type AccountRegistryFile,
  type AccountRegistryStorage
} from './accountRegistry'

vi.mock('electron-store', () => ({ default: class {} }))

class MemoryRegistryStorage implements AccountRegistryStorage {
  value: unknown = undefined
  writes: AccountRegistryFile[] = []

  read(): unknown {
    return this.value
  }

  write(value: AccountRegistryFile): void {
    this.value = structuredClone(value)
    this.writes.push(structuredClone(value))
  }
}

describe('AccountRegistry', () => {
  let session: AccountSession
  let storage: MemoryRegistryStorage
  let registry: AccountRegistry

  beforeEach(() => {
    session = new AccountSession()
    storage = new MemoryRegistryStorage()
    registry = new AccountRegistry(session, storage)
  })

  const recordCurrent = (platform: 'vrchat' | 'chilloutvr', displayName: string): void => {
    const resolution = session.resolve(platform)
    if ('status' in resolution) throw new Error('test identity did not resolve')
    const platformAccountId = session.getAccountId(platform)
    if (platformAccountId === null) throw new Error('test identity disappeared')
    registry.recordAuthenticated(platform, platformAccountId, resolution.epoch, displayName)
  }

  it('records the authenticated AccountSession identity as active', () => {
    session.setIdentity('vrchat', 'usr_a')

    recordCurrent('vrchat', 'Alice')

    expect(registry.listAccounts()).toEqual([
      {
        platform: 'vrchat',
        platformAccountId: 'usr_a',
        displayName: 'Alice',
        isActive: true
      }
    ])
    expect(storage.writes.at(-1)).toMatchObject({
      storeFormatVersion: ACCOUNT_REGISTRY_FORMAT_VERSION
    })
  })

  it('demotes the prior same-platform account while keeping both platforms active', () => {
    session.setIdentity('vrchat', 'usr_a')
    recordCurrent('vrchat', 'Alice')
    session.setIdentity('chilloutvr', 'cvr_a')
    recordCurrent('chilloutvr', 'Casey')
    session.setIdentity('vrchat', null)
    session.setIdentity('vrchat', 'usr_b')
    recordCurrent('vrchat', 'Bob')

    expect(registry.listAccounts()).toEqual([
      {
        platform: 'chilloutvr',
        platformAccountId: 'cvr_a',
        displayName: 'Casey',
        isActive: true
      },
      {
        platform: 'vrchat',
        platformAccountId: 'usr_a',
        displayName: 'Alice',
        isActive: false
      },
      {
        platform: 'vrchat',
        platformAccountId: 'usr_b',
        displayName: 'Bob',
        isActive: true
      }
    ])
  })

  it('tombstones only the explicitly removed account and hides it from Account[]', () => {
    session.setIdentity('vrchat', 'usr_a')
    recordCurrent('vrchat', 'Alice')

    registry.remove('vrchat', 'usr_a')

    expect(registry.listAccounts()).toEqual([])
    expect(registry.listEntries()).toContainEqual({
      platform: 'vrchat',
      platformAccountId: 'usr_a',
      displayName: 'Alice',
      state: 'removed'
    })
  })

  it('restores a tombstone when that account authenticates again', () => {
    session.setIdentity('vrchat', 'usr_a')
    recordCurrent('vrchat', 'Old name')
    registry.remove('vrchat', 'usr_a')

    recordCurrent('vrchat', 'New name')

    expect(registry.listAccounts()).toEqual([
      {
        platform: 'vrchat',
        platformAccountId: 'usr_a',
        displayName: 'New name',
        isActive: true
      }
    ])
  })

  it('does not tombstone an account when AccountSession crosses an identity boundary', () => {
    session.setIdentity('vrchat', 'usr_a')
    recordCurrent('vrchat', 'Alice')

    session.setIdentity('vrchat', null)

    expect(registry.listEntries()).toContainEqual({
      platform: 'vrchat',
      platformAccountId: 'usr_a',
      displayName: 'Alice',
      state: 'active'
    })
    expect(storage.writes).toHaveLength(1)
  })

  it('loads valid durable entries and ignores malformed persisted data', () => {
    storage.value = {
      storeFormatVersion: ACCOUNT_REGISTRY_FORMAT_VERSION,
      entries: {
        'vrchat:usr_a': {
          platform: 'vrchat',
          platformAccountId: 'usr_a',
          displayName: 'Alice',
          state: 'known'
        }
      }
    }
    expect(new AccountRegistry(session, storage).listAccounts()).toHaveLength(1)

    storage.value = { storeFormatVersion: 'bad', entries: [] }
    expect(new AccountRegistry(session, storage).listAccounts()).toEqual([])
  })

  it('rejects authenticated adoption when identity or epoch changed after capture', () => {
    session.setIdentity('vrchat', 'usr_a')
    const captured = session.resolve('vrchat')
    if ('status' in captured) throw new Error('test identity did not resolve')
    session.setIdentity('vrchat', null)
    session.setIdentity('vrchat', 'usr_b')

    expect(() => registry.recordAuthenticated('vrchat', 'usr_a', captured.epoch, 'Alice')).toThrow(
      'stale authenticated identity'
    )
    expect(registry.listEntries()).toEqual([])
    expect(storage.writes).toHaveLength(0)
  })

  it('preserves a newer format marker when its payload shape is incompatible', () => {
    storage.value = { storeFormatVersion: 999, entries: [] }
    registry = new AccountRegistry(session, storage)
    session.setIdentity('vrchat', 'usr_a')

    expect(() => recordCurrent('vrchat', 'Alice')).toThrow(
      'refusing to overwrite data written by a newer version'
    )
    expect(storage.writes).toHaveLength(0)
  })

  it.each(['account:id', 'account.id', 'account id', 'account\nid', 'a'.repeat(129)])(
    'rejects an unsafe removal account id (%j)',
    (platformAccountId) => {
      expect(() => registry.remove('vrchat', platformAccountId)).toThrow(
        'invalid platformAccountId'
      )
      expect(storage.writes).toHaveLength(0)
    }
  )

  it('rejects persisted registry entries with unsafe platform account ids', () => {
    storage.value = {
      storeFormatVersion: ACCOUNT_REGISTRY_FORMAT_VERSION,
      entries: {
        'vrchat:account.id': {
          platform: 'vrchat',
          platformAccountId: 'account.id',
          displayName: 'Unsafe',
          state: 'known'
        }
      }
    }

    expect(new AccountRegistry(session, storage).listEntries()).toEqual([])
  })

  it('skips persistence when authenticated adoption is byte-identical', () => {
    session.setIdentity('vrchat', 'usr_a')
    recordCurrent('vrchat', 'Alice')

    recordCurrent('vrchat', 'Alice')

    expect(storage.writes).toHaveLength(1)
  })
})
