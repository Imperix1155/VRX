// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import type { LinkSnapshot } from '@shared/linkedProfiles'
import {
  linkedProfilesKey,
  subscribeLinkedProfiles,
  useLinkedProfiles
} from '../queries/linkedProfiles'
import '../i18n'
import LinkedProfilesLoadError from './LinkedProfilesLoadError'

function Feedback(): React.JSX.Element | null {
  return <LinkedProfilesLoadError query={useLinkedProfiles()} />
}
afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, 'vrx')
})

it('fences an explicit retry when an identity boundary starts a fresh local read', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const previous: LinkSnapshot = {
    lease: 'previous',
    profiles: [],
    storeRevision: 1,
    accountIds: { vrchat: 'old-owner' }
  }
  const next: LinkSnapshot = {
    lease: 'next',
    profiles: [],
    storeRevision: 1,
    accountIds: { vrchat: 'new-owner' }
  }
  let boundary = (): void => {}
  let finish!: (result: { ok: true; value: LinkSnapshot }) => void
  const read = vi
    .fn()
    .mockResolvedValueOnce({ ok: false, reason: 'storage' })
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    .mockResolvedValueOnce({ ok: true, value: next })
  window.vrx = {
    getLinkedProfiles: read,
    onIdentityBoundary: (callback: () => void) => {
      boundary = callback
      return () => {}
    }
  } as unknown as Window['vrx']
  const dispose = subscribeLinkedProfiles(client)
  render(
    <QueryClientProvider client={client}>
      <Feedback />
    </QueryClientProvider>
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Retry linked profiles' }))
  expect(read).toHaveBeenCalledTimes(2)
  await act(async () => boundary())
  await waitFor(() => expect(client.getQueryData(linkedProfilesKey)).toEqual(next))
  await act(async () => finish({ ok: true, value: previous }))
  expect(client.getQueryData(linkedProfilesKey)).toEqual(next)
  expect(read).toHaveBeenCalledTimes(3)
  expect(screen.queryByRole('alert')).toBeNull()
  dispose()
  client.clear()
})
