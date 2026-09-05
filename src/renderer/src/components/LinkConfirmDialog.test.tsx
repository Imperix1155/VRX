// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LinkResult, LinkSnapshot, LinkedProfile } from '@shared/linkedProfiles'
import LinkConfirmDialog, { type LinkReview } from './LinkConfirmDialog'

const copy = vi.hoisted(() => ({
  'linking.confirm.replace.question': 'Do these accounts belong to the same person?',
  'linking.confirm.replace.warningTitle': 'Existing links will be replaced',
  'linking.confirm.replace.oldPair': '{{first}} + {{second}}',
  'linking.confirm.replace.oldPairEffect':
    'Remove this link and permanently delete its shared note.',
  'linking.confirm.replace.newPairLabel': 'New linked pair',
  'linking.confirm.replace.unlinkedLabel': 'Accounts left unlinked',
  'linking.confirm.replace.unlinkedEffect': '{{name}} will become unlinked, not deleted.',
  'linking.confirm.replace.accountNotes': 'All individual account notes stay unchanged.',
  'linking.confirm.replace.blankNote': 'The new shared note starts blank.',
  'linking.confirm.replace.saveWarning':
    'Save any shared-note text you want to keep before continuing.',
  'linking.confirm.replace.acknowledge':
    'I understand that the listed shared notes will be permanently deleted.',
  'linking.confirm.replace.submit': 'Replace and link',
  'linking.confirm.replace.linkSubmit': 'Link accounts',
  'linking.confirm.preferred.label': 'Preferred platform',
  'linking.confirm.preferred.help':
    'We selected the account you started from. You can change it now or later in Identities.',
  'linking.confirm.combinedName': 'Combined name',
  'linking.confirm.combinedHelp': 'You can set a custom VRX name later.',
  'linking.confirm.sharedNote.summary': 'Shared note for {{name}}',
  'linking.confirm.sharedNote.empty': 'No shared note',
  'linking.confirm.unlink.warning':
    'The shared note will be permanently deleted. Save any text you want to keep before unlinking.',
  'linking.confirm.unlink.accountNotes': 'Both original account notes stay unchanged.',
  'linking.confirm.unlink.acknowledge': 'I understand the shared note will be deleted.',
  'linking.confirm.unlink.submit': 'Unlink and delete shared note',
  'linking.confirm.error.stale': 'The existing link changed. Go back and review it again.',
  'linking.confirm.error.storage':
    'Save failed. Existing links and notes are unchanged. Try again or cancel.',
  'linking.confirm.error.invalid':
    'The reviewed link is no longer valid. Go back and review it again.',
  'linking.confirm.error.unavailable': 'Linking is unavailable. Try again or cancel.',
  'linking.confirm.error.rateLimited': 'Too many attempts. Wait a moment, then try again.',
  'linking.confirm.error.unknown':
    'Save failed. Existing links and notes are unchanged. Try again or cancel.',
  'linking.confirm.platform.vrchat': 'VRChat',
  'linking.confirm.platform.chilloutvr': 'ChilloutVR',
  'linking.confirm.identityUnavailable': 'Data unavailable',
  'linking.confirm.back': 'Back',
  'linking.confirm.cancel': 'Cancel',
  'linking.confirm.pending': 'Saving…'
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: keyof typeof copy, values?: Record<string, string>) =>
      Object.entries(values ?? {}).reduce(
        (message, [name, value]) => message.replace(`{{${name}}}`, value),
        copy[key]
      )
  })
}))

const identities = [
  { ref: { platform: 'vrchat' as const, friendId: 'alice-vrc' }, name: 'Alice VRC' },
  { ref: { platform: 'chilloutvr' as const, friendId: 'alice-cvr' }, name: 'Alice CVR' },
  { ref: { platform: 'vrchat' as const, friendId: 'bob-vrc' }, name: 'Bob VRC' },
  { ref: { platform: 'chilloutvr' as const, friendId: 'bob-cvr' }, name: 'Bob CVR' },
  {
    ref: {
      platform: 'vrchat' as const,
      friendId: 'alice-vrc',
      platformAccountId: 'vrchat-self'
    },
    name: 'Alice VRC'
  },
  {
    ref: {
      platform: 'chilloutvr' as const,
      friendId: 'alice-cvr',
      platformAccountId: 'chilloutvr-self'
    },
    name: 'Alice CVR'
  },
  {
    ref: {
      platform: 'vrchat' as const,
      friendId: 'bob-vrc',
      platformAccountId: 'vrchat-self'
    },
    name: 'Bob VRC'
  },
  {
    ref: {
      platform: 'chilloutvr' as const,
      friendId: 'bob-cvr',
      platformAccountId: 'chilloutvr-self'
    },
    name: 'Bob CVR'
  }
]

function profile(
  id: string,
  first: (typeof identities)[number],
  second: (typeof identities)[number],
  sharedNote: string,
  revision: number
): LinkedProfile {
  return {
    id,
    members: [
      { ...first.ref, platformAccountId: `${first.ref.platform}-self` },
      { ...second.ref, platformAccountId: `${second.ref.platform}-self` }
    ],
    customName: null,
    defaultName: `${first.name} profile`,
    preferredPlatform: first.ref.platform,
    pictureMode: 'preferred',
    sharedNote,
    revision
  }
}

const alice = profile('alice', identities[0]!, identities[1]!, 'Alice private shared note', 4)
const bob = profile('bob', identities[2]!, identities[3]!, 'Bob private shared note', 7)
const replaceReview: LinkReview = {
  kind: 'replace',
  members: [identities[0]!.ref, identities[3]!.ref],
  preferredPlatform: 'vrchat',
  accountIds: { vrchat: 'vrchat-self', chilloutvr: 'chilloutvr-self' },
  affected: [alice, bob]
}

function success(): { ok: true; value: LinkSnapshot } {
  return { ok: true, value: { lease: 'next', storeRevision: 2, profiles: [] } }
}

function renderReview(
  review: LinkReview,
  onSubmit = vi.fn().mockResolvedValue(success()),
  overrides: Partial<React.ComponentProps<typeof LinkConfirmDialog>> = {}
): ReturnType<typeof render> & { props: React.ComponentProps<typeof LinkConfirmDialog> } {
  const props = {
    review,
    identities,
    onSubmit,
    onClose: vi.fn(),
    onBack: vi.fn(),
    onSuccess: vi.fn(),
    ...overrides
  }
  return { ...render(<LinkConfirmDialog {...props} />), props }
}

afterEach(cleanup)

describe('LinkConfirmDialog content', () => {
  it('enumerates both replaced pairs, notes, new pair, and accounts left unlinked', () => {
    renderReview(replaceReview)

    expect(screen.getByText('Alice VRC + Alice CVR')).toBeTruthy()
    expect(screen.getByText('Bob VRC + Bob CVR')).toBeTruthy()
    expect(screen.getByText('Alice private shared note')).toBeTruthy()
    expect(screen.getByText('Bob private shared note')).toBeTruthy()
    const newPair = screen.getByRole('group', { name: 'New linked pair' })
    expect(within(newPair).getByText('Alice VRC')).toBeTruthy()
    expect(within(newPair).getByText('Bob CVR')).toBeTruthy()
    const unlinked = screen.getByRole('list', { name: 'Accounts left unlinked' })
    expect(within(unlinked).getByText('Alice CVR will become unlinked, not deleted.')).toBeTruthy()
    expect(within(unlinked).getByText('Bob VRC will become unlinked, not deleted.')).toBeTruthy()
    expect(screen.getByText('All individual account notes stay unchanged.')).toBeTruthy()
  })

  it('renders a new link without destructive warning or acknowledgement', async () => {
    const onSubmit = vi.fn().mockResolvedValue(success())
    renderReview({ ...replaceReview, affected: [] }, onSubmit)

    expect(screen.queryByText('Existing links will be replaced')).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByRole('heading')).toBeNull()
    const submit = screen.getByRole('button', { name: 'Link accounts' })
    expect((submit as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(submit)

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ expectedPeople: [] }))
    )
  })

  it('keeps an opened shared-note disclosure open while acknowledgement changes', () => {
    renderReview(replaceReview)
    const summary = screen.getByText('Shared note for Alice VRC profile')
    fireEvent.click(summary)
    expect(summary.closest('details')?.hasAttribute('open')).toBe(true)

    fireEvent.click(screen.getByRole('checkbox', { name: /permanently deleted/i }))

    expect(
      screen.getByText('Shared note for Alice VRC profile').closest('details')?.hasAttribute('open')
    ).toBe(true)
  })

  it('does not label an old scoped member with the current account owner name', () => {
    const scopedIdentities = [
      { ref: { platform: 'vrchat' as const, friendId: 'alice-vrc' }, name: 'Current Alice' },
      {
        ref: {
          platform: 'vrchat' as const,
          friendId: 'alice-vrc',
          platformAccountId: 'vrchat-self'
        },
        name: 'Old VRChat account unavailable'
      },
      { ref: { platform: 'chilloutvr' as const, friendId: 'alice-cvr' }, name: 'Current CVR' },
      {
        ref: {
          platform: 'chilloutvr' as const,
          friendId: 'alice-cvr',
          platformAccountId: 'chilloutvr-self'
        },
        name: 'Old CVR account unavailable'
      }
    ]
    renderReview(
      {
        kind: 'replace',
        members: [scopedIdentities[0]!.ref, scopedIdentities[2]!.ref],
        preferredPlatform: 'vrchat',
        accountIds: { vrchat: 'vrchat-self', chilloutvr: 'chilloutvr-self' },
        affected: [alice]
      },
      undefined,
      { identities: scopedIdentities }
    )

    expect(
      screen.getByText('Old VRChat account unavailable + Old CVR account unavailable')
    ).toBeTruthy()
    const newPair = screen.getByRole('group', { name: 'New linked pair' })
    expect(within(newPair).getByText('Current Alice')).toBeTruthy()
    expect(within(newPair).getByText('Current CVR')).toBeTruthy()
  })

  it('uses the localized unavailable label when a reviewed identity is missing', () => {
    renderReview(replaceReview, undefined, {
      identities: [identities[0]!, identities[3]!]
    })

    expect(screen.getAllByText('Data unavailable + Data unavailable')).toHaveLength(2)
    expect(screen.queryByText(/alice-cvr|bob-vrc/)).toBeNull()
  })

  it('keeps an old owner with the same platform friend id in the unlinked list', () => {
    const oldProfile: LinkedProfile = {
      ...alice,
      id: 'old-owner',
      members: [
        { platform: 'vrchat', friendId: 'old-vrc', platformAccountId: 'owner-vrc' },
        { platform: 'chilloutvr', friendId: 'same-cvr', platformAccountId: 'owner-old' }
      ]
    }
    renderReview(
      {
        kind: 'replace',
        members: [
          { platform: 'vrchat', friendId: 'new-vrc' },
          { platform: 'chilloutvr', friendId: 'same-cvr' }
        ],
        preferredPlatform: 'chilloutvr',
        accountIds: { vrchat: 'owner-vrc', chilloutvr: 'owner-new' },
        affected: [oldProfile]
      },
      undefined,
      {
        identities: [
          { ref: { platform: 'vrchat', friendId: 'new-vrc' }, name: 'Current VRChat' },
          { ref: { platform: 'chilloutvr', friendId: 'same-cvr' }, name: 'Current CVR' },
          {
            ref: {
              platform: 'vrchat',
              friendId: 'old-vrc',
              platformAccountId: 'owner-vrc'
            },
            name: 'Old VRChat'
          },
          {
            ref: {
              platform: 'chilloutvr',
              friendId: 'same-cvr',
              platformAccountId: 'owner-old'
            },
            name: 'Old CVR owner unavailable'
          }
        ]
      }
    )

    const newPair = screen.getByRole('group', { name: 'New linked pair' })
    expect(within(newPair).getByText('Current CVR')).toBeTruthy()
    const unlinked = screen.getByRole('list', { name: 'Accounts left unlinked' })
    expect(
      within(unlinked).getByText('Old CVR owner unavailable will become unlinked, not deleted.')
    ).toBeTruthy()
  })

  it('submits one atomic replace with every reviewed revision after acknowledgement', async () => {
    const onSubmit = vi.fn().mockResolvedValue(success())
    const { props } = renderReview(replaceReview, onSubmit)
    const submit = screen.getByRole('button', { name: 'Replace and link' })
    expect((submit as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByRole('checkbox', { name: /permanently deleted/i }))
    fireEvent.click(submit)

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce())
    expect(onSubmit).toHaveBeenCalledWith({
      kind: 'replace',
      members: replaceReview.members,
      preferredPlatform: 'vrchat',
      defaultName: 'Alice VRC',
      expectedPeople: [
        { id: 'alice', revision: 4 },
        { id: 'bob', revision: 7 }
      ]
    })
    await waitFor(() => expect(props.onSuccess).toHaveBeenCalledWith(success().value))
  })

  it('changes the combined-name preview and command with the preferred platform', async () => {
    const onSubmit = vi.fn().mockResolvedValue(success())
    renderReview(replaceReview, onSubmit)
    expect(screen.getByText('Alice VRC', { selector: 'strong' })).toBeTruthy()

    fireEvent.click(screen.getByRole('radio', { name: 'ChilloutVR' }))
    expect(screen.getByText('Bob CVR', { selector: 'strong' })).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: /permanently deleted/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Replace and link' }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ preferredPlatform: 'chilloutvr', defaultName: 'Bob CVR' })
      )
    )
  })

  it('cancels without submitting a mutation', () => {
    const onSubmit = vi.fn().mockResolvedValue(success())
    const { props } = renderReview(replaceReview, onSubmit)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(props.onClose).toHaveBeenCalledOnce()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('requires acknowledgement before unlinking a blank shared note', async () => {
    const blank = profile('blank', identities[0]!, identities[1]!, '', 9)
    const onSubmit = vi.fn().mockResolvedValue(success())
    renderReview({ kind: 'unlink', profile: blank }, onSubmit)
    expect(screen.queryByRole('heading')).toBeNull()
    expect(screen.queryByRole('radiogroup')).toBeNull()
    expect(screen.getByText('No shared note')).toBeTruthy()
    const submit = screen.getByRole('button', { name: 'Unlink and delete shared note' })
    expect((submit as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByRole('checkbox', { name: /shared note will be deleted/i }))
    fireEvent.click(submit)

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        kind: 'unlink',
        personId: 'blank',
        expectedRevision: 9
      })
    )
  })

  it('offers Back after an unlink review becomes stale', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: false, reason: 'stale' })
    const { props } = renderReview({ kind: 'unlink', profile: alice }, onSubmit)
    fireEvent.click(screen.getByRole('checkbox', { name: /shared note will be deleted/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Unlink and delete shared note' }))

    expect((await screen.findByRole('alert')).textContent).toMatch(/changed.*go back/i)
    const back = screen.getByRole('button', { name: 'Back' })
    expect((back as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(back)
    expect(props.onBack).toHaveBeenCalledOnce()
  })

  it('disables a stale review and requires Back instead of retrying', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: false, reason: 'stale' })
    const { props } = renderReview(replaceReview, onSubmit)
    fireEvent.click(screen.getByRole('checkbox', { name: /permanently deleted/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Replace and link' }))

    expect((await screen.findByRole('alert')).textContent).toMatch(/changed.*go back/i)
    expect(screen.getByRole('button', { name: 'Replace and link' }).hasAttribute('disabled')).toBe(
      true
    )
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(props.onBack).toHaveBeenCalledOnce()
    expect(onSubmit).toHaveBeenCalledOnce()
  })

  it('keeps a storage failure retryable only through another explicit submit', async () => {
    const onSubmit = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, reason: 'storage' })
      .mockResolvedValueOnce(success())
    renderReview(replaceReview, onSubmit)
    fireEvent.click(screen.getByRole('checkbox', { name: /permanently deleted/i }))
    const submit = screen.getByRole('button', { name: 'Replace and link' })
    fireEvent.click(submit)

    expect((await screen.findByRole('alert')).textContent).toMatch(/save failed.*try again/i)
    expect(onSubmit).toHaveBeenCalledOnce()
    expect((submit as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(submit)
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2))
  })

  it('prevents duplicate submissions while the reviewed command is pending', async () => {
    let finish: (result: LinkResult<LinkSnapshot>) => void = () => {}
    const onSubmit = vi.fn(
      () =>
        new Promise<LinkResult<LinkSnapshot>>((resolve) => {
          finish = resolve
        })
    )
    renderReview(replaceReview, onSubmit)
    fireEvent.click(screen.getByRole('checkbox', { name: /permanently deleted/i }))
    const submit = screen.getByRole('button', { name: 'Replace and link' })

    fireEvent.click(submit)
    fireEvent.click(submit)

    expect(onSubmit).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Saving…' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Back' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Cancel' }).hasAttribute('disabled')).toBe(true)
    await act(async () => finish(success()))
  })
})
