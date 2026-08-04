import { describe, expect, it } from 'vitest'
import { NOT_CONNECTED_KEY } from './notConnectedKeys'

describe('NOT_CONNECTED_KEY', () => {
  it('keeps each social surface in its own locale namespace', () => {
    expect(NOT_CONNECTED_KEY).toEqual({
      friends: {
        vrchat: 'friends.notConnected.vrchat',
        chilloutvr: 'friends.notConnected.chilloutvr'
      },
      dashboard: {
        vrchat: 'dashboard.notConnected.vrchat',
        chilloutvr: 'dashboard.notConnected.chilloutvr'
      }
    })
  })
})
