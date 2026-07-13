// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { friendsQueryKey } from '../queries/friends'
import { useIdentityBoundary } from './useIdentityBoundary'

const queryClient = vi.hoisted(() => ({
  cancelQueries: vi.fn(),
  removeQueries: vi.fn()
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => queryClient
}))

let fire: ((payload: { platform: 'vrchat' | 'chilloutvr' }) => void) | undefined
const unsubscribe = vi.fn(() => {
  fire = undefined
})

function Probe(): React.JSX.Element {
  useIdentityBoundary()
  return <></>
}

afterEach(() => {
  cleanup()
  fire = undefined
  unsubscribe.mockClear()
  queryClient.cancelQueries.mockClear()
  queryClient.removeQueries.mockClear()
  Object.assign(window, { vrx: undefined })
})

describe('useIdentityBoundary', () => {
  it('cancels then removes the platform friends query and unsubscribes on unmount', () => {
    Object.assign(window, {
      vrx: {
        onIdentityBoundary: (
          callback: (payload: { platform: 'vrchat' | 'chilloutvr' }) => void
        ) => {
          fire = callback
          return unsubscribe
        }
      }
    })

    const mounted = render(<Probe />)
    act(() => fire?.({ platform: 'chilloutvr' }))

    const filters = { queryKey: friendsQueryKey('chilloutvr') }
    expect(queryClient.cancelQueries).toHaveBeenCalledWith(filters)
    expect(queryClient.removeQueries).toHaveBeenCalledWith(filters)
    expect(queryClient.cancelQueries.mock.invocationCallOrder[0]).toBeLessThan(
      queryClient.removeQueries.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
    )

    mounted.unmount()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})
