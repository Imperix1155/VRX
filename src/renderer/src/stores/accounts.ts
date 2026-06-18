import { create } from 'zustand'
import type { Account, Platform } from '@shared/types'

/**
 * Accounts store (VRX-21). Loads the account list over the IPC bridge; the
 * multi-account model itself is VRX-24, so `get-accounts` returns `[]` until
 * then. The active account for a platform is derived from `Account.isActive`
 * (single source of truth — no separate active-id state to drift).
 */
interface AccountsState {
  accounts: Account[]
  loading: boolean
  error: string | null
  fetchAccounts: () => Promise<void>
  /** The active account for a platform, or null when none is active. */
  activeAccount: (platform: Platform) => Account | null
}

export const useAccountsStore = create<AccountsState>((set, get) => ({
  accounts: [],
  loading: false,
  error: null,
  fetchAccounts: async () => {
    if (!window.vrx) {
      set({ accounts: [], loading: false, error: 'bridge_unavailable' })
      return
    }
    set({ loading: true, error: null })
    try {
      const accounts = await window.vrx.getAccounts()
      set({ accounts, loading: false })
    } catch (err) {
      set({ error: String(err), loading: false })
    }
  },
  activeAccount: (platform) =>
    get().accounts.find((account) => account.platform === platform && account.isActive) ?? null
}))
