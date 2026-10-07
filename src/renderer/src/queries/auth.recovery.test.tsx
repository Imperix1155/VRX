// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuthStatus } from './auth'
import type { AuthStatus } from '@shared/types'
function NewObserver(): React.JSX.Element {
  useAuthStatus('vrchat')
  return <span>Recovery mounted</span>
}
function Gate(): React.JSX.Element {
  const status = useAuthStatus('vrchat')
  return (
    <>
      {status.isError && (
        <>
          <NewObserver />
          <button onClick={() => void status.refetch()}>Retry</button>
        </>
      )}
      {status.data && <span>{status.data.state}</span>}
    </>
  )
}
afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, 'vrx')
})
it('mounting recovery after initial auth rejection cannot restart requests; explicit Retry can', async () => {
  const getAuthStatus = vi
    .fn<() => Promise<AuthStatus>>()
    .mockRejectedValueOnce(new Error('ipc failure'))
    .mockReturnValue(new Promise(() => {}))
  Object.assign(window, { vrx: { getAuthStatus } })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <Gate />
    </QueryClientProvider>
  )
  await waitFor(() => expect(getAuthStatus).toHaveBeenCalled())
  await new Promise((resolve) => setTimeout(resolve, 30))
  expect(getAuthStatus).toHaveBeenCalledOnce()
  expect(screen.getByText('Recovery mounted')).toBeTruthy()
  getAuthStatus.mockResolvedValue({
    platform: 'vrchat',
    state: 'unauthenticated',
    accountId: null,
    displayName: null
  })
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(await screen.findByText('unauthenticated')).toBeTruthy()
  expect(getAuthStatus).toHaveBeenCalledTimes(2)
  client.clear()
})
