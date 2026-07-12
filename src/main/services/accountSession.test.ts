import { describe, expect, it } from 'vitest'
import { AccountSession, accountKey } from './accountSession'

describe('AccountSession', () => {
  it('sets, reads, idempotently re-sets, and clears identity per platform', () => {
    const session = new AccountSession()

    expect(session.getAccountId('vrchat')).toBeNull()
    expect(session.getAccountId('chilloutvr')).toBeNull()

    session.setIdentity('vrchat', 'usr_123')
    session.setIdentity('vrchat', 'usr_123')
    session.setIdentity('chilloutvr', 'cvr_456')

    expect(session.getAccountId('vrchat')).toBe('usr_123')
    expect(session.getAccountId('chilloutvr')).toBe('cvr_456')

    session.setIdentity('vrchat', null)

    expect(session.getAccountId('vrchat')).toBeNull()
    expect(session.getAccountId('chilloutvr')).toBe('cvr_456')
  })

  it('advances a platform epoch only when its identity changes', () => {
    const session = new AccountSession()

    session.setIdentity('vrchat', 'usr_a')
    const first = session.resolve('vrchat')
    session.setIdentity('vrchat', 'usr_a')
    const repeated = session.resolve('vrchat')
    session.setIdentity('vrchat', null)
    session.setIdentity('vrchat', 'usr_b')
    const switched = session.resolve('vrchat')

    expect(first).toMatchObject({ epoch: 1 })
    expect(repeated).toMatchObject({ epoch: 1 })
    expect(switched).toMatchObject({ epoch: 3 })
  })

  it('resolves typed no-active, resolving, and ready states', () => {
    const session = new AccountSession()

    expect(session.resolve('vrchat')).toEqual({ status: 'no-active' })

    session.setIdentity('vrchat', 'usr_a')
    const ready = session.resolve('vrchat')
    expect(ready).toEqual({ accountKey: 'vrchat:usr_a', epoch: 1, ready: true })
    expect(Object.isFrozen(ready)).toBe(true)

    session.setIdentity('vrchat', null)
    expect(session.resolve('vrchat')).toEqual({ status: 'resolving' })
  })

  it('tracks epochs and readiness independently per platform', () => {
    const session = new AccountSession()

    session.setIdentity('vrchat', 'usr_a')

    expect(session.resolve('vrchat')).toMatchObject({ epoch: 1, ready: true })
    expect(session.resolve('chilloutvr')).toEqual({ status: 'no-active' })
  })
})

describe('accountKey', () => {
  it('builds a platform-qualified account key', () => {
    expect(accountKey('vrchat', 'usr_123')).toBe('vrchat:usr_123')
    expect(accountKey('chilloutvr', 'cvr_456')).toBe('chilloutvr:cvr_456')
  })

  it.each(['', '   ', 'account:id', 'account.id', 'account id', 'account\nid', 'a'.repeat(129)])(
    'rejects an unsafe account id (%j)',
    (accountId) => {
      expect(() => accountKey('vrchat', accountId)).toThrow('invalid platformAccountId')
    }
  )

  it('rejects an unsafe identity before storing it in AccountSession', () => {
    const session = new AccountSession()

    expect(() => session.setIdentity('vrchat', 'account:id')).toThrow('invalid platformAccountId')
    expect(session.resolve('vrchat')).toEqual({ status: 'no-active' })
  })
})
