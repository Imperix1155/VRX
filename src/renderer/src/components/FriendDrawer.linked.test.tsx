// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LinkedProfile } from '@shared/linkedProfiles'
import { fullFriend } from '../test-utils/friendFixture'
import { linkedProfilesKey } from '../queries/linkedProfiles'
import { resetPersonNoteCoordinatorForTests } from '../hooks/usePersonNote'
import { resolveLinkedProfile, type ProfileTarget } from '../utils/projectLinkedFriends'
import '../i18n'
import FriendDrawer from './FriendDrawer'

const vrc = fullFriend('VRC', 'vrchat')
const cvr = fullFriend('CVR', 'chilloutvr')
const profile: LinkedProfile = {
  id: 'pair',
  members: [
    { platform: 'vrchat', platformAccountId: 'v', friendId: vrc.platformUserId },
    { platform: 'chilloutvr', platformAccountId: 'c', friendId: cvr.platformUserId }
  ],
  preferredPlatform: 'vrchat',
  customName: 'Together',
  defaultName: 'VRC',
  pictureMode: 'preferred',
  sharedNote: 'Shared saved text',
  revision: 1
}
const person: ProfileTarget = {
  kind: 'person',
  personId: 'pair',
  anchor: { platform: 'vrchat', friendId: vrc.platformUserId }
}
let client: QueryClient
let change: ReturnType<typeof vi.fn>
let getAccountNote: ReturnType<typeof vi.fn>
const navigate = vi.fn()
function drawer(target: ProfileTarget, friends = [vrc, cvr]): React.JSX.Element {
  const selection = resolveLinkedProfile(target, {
    friends,
    profiles: [profile],
    accountIds: { vrchat: 'v', chilloutvr: 'c' }
  })
  return (
    <QueryClientProvider client={client}>
      <FriendDrawer
        friend={selection?.header ?? null}
        selection={selection}
        onClose={vi.fn()}
        onNavigate={navigate}
      />
    </QueryClientProvider>
  )
}
beforeEach(() => {
  resetPersonNoteCoordinatorForTests()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const snapshot = { profiles: [profile], lease: 'lease' }
  client.setQueryData(linkedProfilesKey, snapshot)
  change = vi.fn().mockImplementation(({ change }) =>
    Promise.resolve({
      ok: true,
      value: {
        ...snapshot,
        profiles: [{ ...profile, sharedNote: change.patch.sharedNote, revision: 2 }]
      }
    })
  )
  getAccountNote = vi.fn().mockImplementation(({ platform }) =>
    Promise.resolve({
      note: platform + ' private note',
      revision: { platformAccountId: platform, epoch: 1 }
    })
  )
  window.vrx = {
    getLinkedProfiles: vi.fn().mockResolvedValue({ ok: true, value: snapshot }),
    changeLinkedProfile: change,
    getFriendNote: getAccountNote,
    setFriendNote: vi.fn().mockResolvedValue({ ok: true }),
    onIdentityBoundary: () => () => {}
  } as unknown as Window['vrx']
  navigate.mockClear()
})
afterEach(() => {
  cleanup()
  client.clear()
})
describe('linked drawer ownership', () => {
  it('names an empty-name account drawer with the visible fallback', () => {
    render(
      drawer(
        {
          kind: 'account',
          personId: 'pair',
          account: { platform: 'vrchat', friendId: vrc.platformUserId }
        },
        [{ ...vrc, displayName: '' }, cvr]
      )
    )
    expect(screen.getByRole('dialog', { name: 'Unknown friend' })).toBeTruthy()
  })

  it('shows only the shared note in a combined profile, preserving its editor across presence changes', async () => {
    const view = render(drawer(person))
    const editor = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Shared notes' })
    await waitFor(() => expect(editor.value).toBe('Shared saved text'))
    expect(getAccountNote).not.toHaveBeenCalled()
    fireEvent.change(editor, { target: { value: 'Unsaved shared draft' } })
    editor.focus()
    editor.setSelectionRange(5, 8)
    view.rerender(drawer(person, [vrc, { ...cvr, presence: { state: 'offline' } }]))
    expect(screen.getByRole('textbox')).toBe(editor)
    expect(editor.value).toBe('Unsaved shared draft')
    expect(editor.selectionStart).toBe(5)
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('Together')
    expect(change).not.toHaveBeenCalled()
  })
  it('keeps account notes separate and provides explicit navigation back', async () => {
    render(
      drawer({
        kind: 'account',
        personId: 'pair',
        account: { platform: 'vrchat', friendId: vrc.platformUserId }
      })
    )
    const editor = screen.getByRole<HTMLTextAreaElement>('textbox')
    await waitFor(() => expect(editor.value).toBe('vrchat private note'))
    expect(screen.queryByText('Shared notes')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Back to combined profile' }))
    expect(navigate).toHaveBeenCalledWith(person)
  })
  it('flushes the old shared owner when navigation removes the editor without a browser blur', async () => {
    const view = render(drawer(person))
    const editor = screen.getByRole<HTMLTextAreaElement>('textbox')
    await waitFor(() => expect(editor.value).toBe('Shared saved text'))
    fireEvent.change(editor, { target: { value: 'Keep this edit' } })
    view.rerender(
      drawer({
        kind: 'account',
        personId: 'pair',
        account: { platform: 'chilloutvr', friendId: cvr.platformUserId }
      })
    )
    await waitFor(() =>
      expect(change).toHaveBeenCalledWith({
        lease: 'lease',
        change: {
          kind: 'update',
          personId: 'pair',
          expectedRevision: 1,
          patch: { sharedNote: 'Keep this edit' }
        }
      })
    )
  })
})
