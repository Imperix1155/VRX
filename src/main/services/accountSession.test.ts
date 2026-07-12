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
})

describe('accountKey', () => {
  it('builds a platform-qualified account key', () => {
    expect(accountKey('vrchat', 'usr_123')).toBe('vrchat:usr_123')
    expect(accountKey('chilloutvr', 'cvr_456')).toBe('chilloutvr:cvr_456')
  })

  it.each(['', '   '])('rejects an empty account id (%j)', (accountId) => {
    expect(() => accountKey('vrchat', accountId)).toThrow('accountId must not be empty')
  })
})
