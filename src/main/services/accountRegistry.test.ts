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

  it('records the authenticated AccountSession identity as active', () => {
    session.setIdentity('vrchat', 'usr_a')

    registry.recordAuthenticated('vrchat', 'Alice')

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
    registry.recordAuthenticated('vrchat', 'Alice')
    session.setIdentity('chilloutvr', 'cvr_a')
    registry.recordAuthenticated('chilloutvr', 'Casey')
    session.setIdentity('vrchat', null)
    session.setIdentity('vrchat', 'usr_b')
    registry.recordAuthenticated('vrchat', 'Bob')

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
    registry.recordAuthenticated('vrchat', 'Alice')

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
    registry.recordAuthenticated('vrchat', 'Old name')
    registry.remove('vrchat', 'usr_a')

    registry.recordAuthenticated('vrchat', 'New name')

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
    registry.recordAuthenticated('vrchat', 'Alice')

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
})
