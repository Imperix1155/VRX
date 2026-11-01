// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OwnProfile } from '@shared/ownProfile'
import type { Platform } from '@shared/types'
import i18n from '../i18n'
import AccountCard from './AccountCard'

const msg = (key: string, options?: Record<string, string | number>): string => i18n.t(key, options)

function stored(platform: Platform): OwnProfile {
  return platform === 'vrchat'
    ? { platform, bio: 'Old bio', pronouns: 'they/them', status: 'online', statusText: '' }
    : { platform, bio: 'Old bio', pronouns: 'they/them', status: null, statusText: null }
}

function setup(platform: Platform): {
  getOwnProfile: ReturnType<typeof vi.fn>
  saveOwnProfile: ReturnType<typeof vi.fn>
} {
  const getOwnProfile = vi.fn().mockResolvedValue({ ok: true, profile: stored(platform) })
  const saveOwnProfile = vi.fn(async ({ changes }: { changes: Partial<OwnProfile> }) => ({
    ok: true,
    profile: { ...stored(platform), ...changes }
  }))
  window.vrx = {
    getAuthStatus: vi.fn().mockResolvedValue({
      state: 'authenticated',
      accountId: `${platform}-account`,
      displayName: 'Neo'
    }),
    getOwnProfile,
    saveOwnProfile,
    logout: vi.fn()
  } as unknown as Window['vrx']
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <AccountCard platform={platform} profileEditing />
    </QueryClientProvider>
  )
  return { getOwnProfile, saveOwnProfile }
}

async function openEditor(): Promise<HTMLElement> {
  fireEvent.click(
    await screen.findByRole('button', { name: msg('settings.accounts.profile.edit') })
  )
  const dialog = await screen.findByRole('dialog')
  await within(dialog).findByLabelText(msg('settings.accounts.profile.bio'))
  return dialog
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function (): void {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function (): void {
    this.removeAttribute('open')
  }
})

afterEach(() => {
  cleanup()
  window.vrx = undefined
})

describe.each(['vrchat', 'chilloutvr'] as const)('Edit profile — %s', (platform) => {
  it('reads only when the editor opens and shows the same fields in the same order', async () => {
    const { getOwnProfile } = setup(platform)
    await screen.findByRole('button', { name: msg('settings.accounts.profile.edit') })
    expect(getOwnProfile).not.toHaveBeenCalled()
    const dialog = await openEditor()
    expect(getOwnProfile).toHaveBeenCalledWith({ platform })
    const bio = within(dialog).getByLabelText(msg('settings.accounts.profile.bio'))
    const pronouns = within(dialog).getByLabelText(msg('settings.accounts.profile.pronouns'))
    expect(bio).toHaveProperty('value', 'Old bio')
    expect(pronouns).toHaveProperty('value', 'they/them')
    // Bio comes before pronouns on both platforms.
    expect(bio.compareDocumentPosition(pronouns) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // Save stays off until something changes.
    expect(
      within(dialog).getByRole('button', { name: msg('settings.accounts.profile.save') })
    ).toHaveProperty('disabled', true)
  })

  it('sends only the changed field, closes, and says it saved', async () => {
    const { saveOwnProfile } = setup(platform)
    const dialog = await openEditor()
    fireEvent.change(within(dialog).getByLabelText(msg('settings.accounts.profile.bio')), {
      target: { value: 'New bio' }
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: msg('settings.accounts.profile.save') })
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(saveOwnProfile).toHaveBeenCalledWith({ platform, changes: { bio: 'New bio' } })
    expect(
      await screen.findByText(
        msg('settings.accounts.profile.saved', {
          platform: msg(`settings.accounts.${platform}.label`)
        })
      )
    ).toBeTruthy()
  })

  it('keeps the edits and explains a failed Save', async () => {
    const { saveOwnProfile } = setup(platform)
    saveOwnProfile.mockResolvedValueOnce({ ok: false, reason: 'cooldown' })
    const dialog = await openEditor()
    fireEvent.change(within(dialog).getByLabelText(msg('settings.accounts.profile.pronouns')), {
      target: { value: 'she/her' }
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: msg('settings.accounts.profile.save') })
    )
    expect(
      await within(dialog).findByText(msg('settings.accounts.profile.error.wait'))
    ).toBeTruthy()
    expect(within(dialog).getByLabelText(msg('settings.accounts.profile.pronouns'))).toHaveProperty(
      'value',
      'she/her'
    )
  })

  it('offers a retry when the profile cannot be read', async () => {
    const { getOwnProfile } = setup(platform)
    getOwnProfile.mockResolvedValueOnce({ ok: false, reason: 'unavailable' })
    fireEvent.click(
      await screen.findByRole('button', { name: msg('settings.accounts.profile.edit') })
    )
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(
      await within(dialog).findByRole('button', { name: msg('settings.accounts.retry') })
    )
    expect(await within(dialog).findByLabelText(msg('settings.accounts.profile.bio'))).toBeTruthy()
    expect(getOwnProfile).toHaveBeenCalledTimes(2)
  })
})

describe('Edit profile — welcome setup', () => {
  it('the setup cards keep to signing in: no Edit profile there', async () => {
    window.vrx = {
      getAuthStatus: vi.fn().mockResolvedValue({
        state: 'authenticated',
        accountId: 'vrchat-account',
        displayName: 'Neo'
      }),
      logout: vi.fn()
    } as unknown as Window['vrx']
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AccountCard platform="vrchat" />
      </QueryClientProvider>
    )
    expect(
      await screen.findByRole('button', { name: msg('settings.accounts.signOut') })
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: msg('settings.accounts.profile.edit') })).toBeNull()
  })
})

describe('Edit profile — status', () => {
  it('VRChat lists the four statuses with their words and sends a picked one', async () => {
    const { saveOwnProfile } = setup('vrchat')
    const dialog = await openEditor()
    const group = within(dialog).getByRole('group', {
      name: msg('settings.accounts.profile.status')
    })
    const radios = within(group).getAllByRole('radio')
    expect(radios.map((radio) => radio.closest('label')!.textContent)).toEqual([
      msg('friends.status.joinMe'),
      msg('friends.status.online'),
      msg('friends.status.askMe'),
      msg('friends.status.dnd')
    ])
    expect(within(group).getByRole('radio', { name: msg('friends.status.online') })).toHaveProperty(
      'checked',
      true
    )
    fireEvent.click(within(group).getByRole('radio', { name: msg('friends.status.dnd') }))
    fireEvent.change(within(dialog).getByLabelText(msg('settings.accounts.profile.statusText')), {
      target: { value: 'Heads down' }
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: msg('settings.accounts.profile.save') })
    )
    await waitFor(() =>
      expect(saveOwnProfile).toHaveBeenCalledWith({
        platform: 'vrchat',
        changes: { status: 'dnd', statusText: 'Heads down' }
      })
    )
  })

  it('ChilloutVR shows no status fields, since it has no status to set', async () => {
    setup('chilloutvr')
    const dialog = await openEditor()
    expect(
      within(dialog).queryByRole('group', { name: msg('settings.accounts.profile.status') })
    ).toBeNull()
    expect(within(dialog).queryByLabelText(msg('settings.accounts.profile.statusText'))).toBeNull()
  })
})
