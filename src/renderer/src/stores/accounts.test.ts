import { beforeEach, describe, expect, it } from 'vitest'
import type { Account } from '@shared/types'
import { useAccountsStore } from './accounts'

const ACCOUNTS: Account[] = [
  { accountId: 'vrc-1', platform: 'vrchat', displayName: 'Main', isActive: false },
  { accountId: 'vrc-2', platform: 'vrchat', displayName: 'Alt', isActive: true },
  { accountId: 'cvr-1', platform: 'chilloutvr', displayName: 'CVR', isActive: false }
]

describe('useAccountsStore', () => {
  beforeEach(() => {
    useAccountsStore.setState({ accounts: [], loading: false, error: null })
  })

  it('starts empty', () => {
    const state = useAccountsStore.getState()
    expect(state.accounts).toEqual([])
    expect(state.loading).toBe(false)
    expect(state.error).toBeNull()
  })

  it('activeAccount returns the active account for a platform', () => {
    useAccountsStore.setState({ accounts: ACCOUNTS })
    expect(useAccountsStore.getState().activeAccount('vrchat')?.accountId).toBe('vrc-2')
  })

  it('activeAccount returns null when no account is active for a platform', () => {
    useAccountsStore.setState({ accounts: ACCOUNTS })
    // chilloutvr has an account but none marked active
    expect(useAccountsStore.getState().activeAccount('chilloutvr')).toBeNull()
  })

  it('activeAccount returns null when there are no accounts', () => {
    expect(useAccountsStore.getState().activeAccount('vrchat')).toBeNull()
  })
})
