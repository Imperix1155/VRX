import { describe, expect, it } from 'vitest'
import { useProfileSelection } from './profileSelection'

describe('profile selection', () => {
  it('retains explicit person ownership until navigation or close', () => {
    const target = {
      kind: 'person' as const,
      personId: 'p',
      anchor: { platform: 'vrchat' as const, friendId: 'a' }
    }
    useProfileSelection.getState().select(target)
    expect(useProfileSelection.getState().target).toEqual(target)
    useProfileSelection.getState().select({
      kind: 'account',
      personId: 'p',
      account: { platform: 'chilloutvr', friendId: 'b' }
    })
    expect(useProfileSelection.getState().target?.kind).toBe('account')
    useProfileSelection.getState().select(null)
    expect(useProfileSelection.getState().target).toBeNull()
  })
})
