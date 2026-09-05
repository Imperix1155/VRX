// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Friend } from '@shared/types'
import type { LinkSnapshot } from '@shared/linkedProfiles'
import { fullFriend } from '../test-utils/friendFixture'
import { linkedProfilesKey } from '../queries/linkedProfiles'
import { resolveLinkedProfile } from '../utils/projectLinkedFriends'
import '../i18n'
import IdentitiesDialog from './IdentitiesDialog'

const source = fullFriend('Origin', 'vrchat')
const candidate = {
  ...fullFriend('Counterpart', 'chilloutvr'),
  presence: { state: 'offline' as const }
}
let snapshot: LinkSnapshot
let client: QueryClient
let mutate: ReturnType<typeof vi.fn>
const navigate = vi.fn()
const close = vi.fn()
function dialog(
  friends: Friend[] = [source, candidate],
  accounts = { vrchat: 'v', chilloutvr: 'c' }
): React.JSX.Element {
  const selection = resolveLinkedProfile(
    {
      kind: 'account',
      personId: snapshot.profiles[0]?.id ?? null,
      account: { platform: 'vrchat', friendId: source.platformUserId }
    },
    { friends, profiles: snapshot.profiles, accountIds: accounts }
  )!
  return (
    <QueryClientProvider client={client}>
      <IdentitiesDialog
        selection={selection}
        friends={friends}
        accountIds={accounts}
        onClose={close}
        onNavigate={navigate}
      />
    </QueryClientProvider>
  )
}
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function (): void {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function (): void {
    this.removeAttribute('open')
  }
  snapshot = { lease: 'lease', storeRevision: 1, profiles: [] }
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(linkedProfilesKey, snapshot)
  mutate = vi.fn().mockResolvedValue({ ok: false, reason: 'storage' })
  window.vrx = {
    getLinkedProfiles: vi
      .fn()
      .mockImplementation(() => Promise.resolve({ ok: true, value: snapshot })),
    changeLinkedProfile: mutate,
    onIdentityBoundary: () => () => {}
  } as unknown as Window['vrx']
  navigate.mockClear()
  close.mockClear()
})
afterEach(() => {
  cleanup()
  client.clear()
})
describe('identity management', () => {
  it('selects duplicate names by exact friend identity and creates a blank-note link', async () => {
    const duplicate = { ...candidate, platformUserId: 'different_friend' }
    render(dialog([source, candidate, duplicate]))
    fireEvent.click(screen.getByRole('button', { name: 'Link an account' }))
    const choices = within(screen.getByRole('list', { name: 'Friends' })).getAllByRole('button')
    fireEvent.click(choices[1]!)
    expect(screen.queryByRole('checkbox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Link accounts' }))
    await waitFor(() => expect(mutate).toHaveBeenCalledOnce())
    expect(mutate.mock.calls[0]?.[0]).toEqual({
      lease: 'lease',
      change: {
        kind: 'replace',
        members: [
          { platform: 'vrchat', friendId: source.platformUserId },
          { platform: 'chilloutvr', friendId: 'different_friend' }
        ],
        preferredPlatform: 'vrchat',
        defaultName: 'Origin',
        expectedPeople: []
      }
    })
  })
  it('keeps one healthy identity usable for acknowledged unlink', async () => {
    snapshot.profiles = [
      {
        id: 'pair',
        members: [
          { platform: 'vrchat', platformAccountId: 'v', friendId: source.platformUserId },
          { platform: 'chilloutvr', platformAccountId: 'old-c', friendId: candidate.platformUserId }
        ],
        customName: null,
        defaultName: 'Origin',
        preferredPlatform: 'vrchat',
        pictureMode: 'preferred',
        sharedNote: 'Save me first',
        revision: 4
      }
    ]
    client.setQueryData(linkedProfilesKey, snapshot)
    render(dialog([source], { vrchat: 'v', chilloutvr: '' }))
    expect(screen.getByText('This account is still linked.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Unlink accounts' }))
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Unlink and delete shared note' })
        .disabled
    ).toBe(true)
    expect(screen.getByText('Save me first')).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Unlink and delete shared note' }))
    await waitFor(() => expect(mutate).toHaveBeenCalledOnce())
    expect(mutate.mock.calls[0]?.[0]).toEqual({
      lease: 'lease',
      change: { kind: 'unlink', personId: 'pair', expectedRevision: 4 }
    })
  })
  it('closes a reviewed confirmation when the session lease changes', async () => {
    render(dialog())
    fireEvent.click(screen.getByRole('button', { name: 'Link an account' }))
    fireEvent.click(within(screen.getByRole('list', { name: 'Friends' })).getByRole('button'))
    client.setQueryData(linkedProfilesKey, { profiles: [], lease: 'different', storeRevision: 2 })
    await waitFor(() => expect(close).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Link accounts' }))
    expect(mutate).not.toHaveBeenCalled()
  })
  it('includes offline friends and searches without changing accounts', () => {
    render(dialog())
    fireEvent.click(screen.getByRole('button', { name: 'Link an account' }))
    const results = screen.getByRole('list', { name: 'Friends' })
    expect(within(results).getByText('Counterpart')).toBeTruthy()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'no match' } })
    expect(screen.getByText('No matching friends.')).toBeTruthy()
    expect(mutate).not.toHaveBeenCalled()
  })
  it('does not offer a new link when the other signed-in account is unavailable', () => {
    render(dialog([source], { vrchat: 'v', chilloutvr: '' }))
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Link an account' }).disabled
    ).toBe(true)
  })
  it('keeps custom names when preference changes and clears custom mode only explicitly', async () => {
    snapshot.profiles = [
      {
        id: 'pair',
        members: [
          { platform: 'vrchat', platformAccountId: 'v', friendId: source.platformUserId },
          { platform: 'chilloutvr', platformAccountId: 'c', friendId: candidate.platformUserId }
        ],
        customName: 'Custom',
        defaultName: 'Origin',
        preferredPlatform: 'vrchat',
        pictureMode: 'preferred',
        sharedNote: '',
        revision: 1
      }
    ]
    client.setQueryData(linkedProfilesKey, snapshot)
    render(dialog())
    fireEvent.change(screen.getByRole('combobox', { name: 'Preferred platform' }), {
      target: { value: 'chilloutvr' }
    })
    await waitFor(() => expect(mutate).toHaveBeenCalledOnce())
    expect(mutate.mock.calls[0]?.[0].change.patch).toEqual({
      preferredPlatform: 'chilloutvr',
      defaultName: 'Counterpart'
    })
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>('button', { name: 'Use platform name' }).disabled
      ).toBe(false)
    )
    fireEvent.click(screen.getByRole('button', { name: 'Use platform name' }))
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(2))
    expect(mutate.mock.calls[1]?.[0].change.patch).toEqual({
      customName: null,
      defaultName: 'Origin'
    })
  })
})
