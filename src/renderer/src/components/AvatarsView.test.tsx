// @vitest-environment jsdom
/**
 * Avatars page (owner, 2026-10-27): one unified page where VRChat and
 * ChilloutVR get the same cards, notices and sheet; the worn avatar can be
 * switched from the sheet, and nothing loads for a signed-out platform.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AvatarItem, AvatarLibraryResult } from '@shared/avatarLibrary'
import type { AuthStatus, Platform } from '@shared/types'
import i18n from '../i18n'
import { useFriendsStore } from '../stores/friends'
import { useUiStore } from '../stores/ui'
import AvatarsView, { UPLOADS_FIRST_STEP } from './AvatarsView'

vi.mock('../hooks/useAvatar', () => ({ useAvatar: () => null }))
const authState = vi.hoisted(() => ({ vrchat: 'authenticated', chilloutvr: 'authenticated' }))
vi.mock('../queries/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../queries/auth')>()),
  useAuthStatus: (platform: Platform) => {
    const state = authState[platform]
    const data: AuthStatus =
      state === 'authenticated'
        ? { platform, state, accountId: `${platform}-me`, displayName: 'Me' }
        : { platform, state: 'unauthenticated', accountId: null, displayName: null }
    return { data, isSuccess: true, isFetching: false, isPending: false }
  }
}))

const msg = (key: string, opts?: Record<string, unknown>): string => i18n.t(key, opts)

function avatar(platform: Platform, index: number, name: string): AvatarItem {
  const guid = `5a3c1e2d-0000-4000-8000-${String(index).padStart(12, '0')}`
  return {
    platform,
    avatarId: platform === 'vrchat' ? `avtr_${guid}` : guid,
    name,
    description: null,
    imageUrl: null,
    authorName: 'Me',
    visibility: 'private',
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-02-03T00:00:00.000Z'
  }
}

const vrcWorn = avatar('vrchat', 1, 'Lumen Fox')
const vrcOther = avatar('vrchat', 2, 'Night Runner')
const cvrWorn = avatar('chilloutvr', 3, 'Ember Synth')
const cvrOther = avatar('chilloutvr', 4, 'Harbor Otter')

function library(platform: Platform): AvatarLibraryResult {
  return platform === 'vrchat'
    ? { ok: true, platform, avatars: [vrcOther, vrcWorn], complete: true, current: vrcWorn }
    : { ok: true, platform, avatars: [cvrOther, cvrWorn], complete: true, current: cvrWorn }
}

const bridge = {
  getAvatarLibrary: vi.fn(({ platform }: { platform: Platform }) =>
    Promise.resolve(library(platform))
  ),
  getAvatarDetails: vi.fn(({ platform, avatarId }: { platform: Platform; avatarId: string }) =>
    Promise.resolve({
      ok: true,
      avatar: [vrcWorn, vrcOther, cvrWorn, cvrOther].find(
        (item) => item.platform === platform && item.avatarId === avatarId
      )
    })
  ),
  switchAvatar: vi.fn(() => Promise.resolve({ ok: true }))
}

function renderView(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <AvatarsView />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  bridge.getAvatarLibrary.mockImplementation(({ platform }) => Promise.resolve(library(platform)))
  Object.defineProperty(window, 'vrx', { value: bridge, configurable: true, writable: true })
  class Observer {
    observe = vi.fn()
    disconnect = vi.fn()
  }
  vi.stubGlobal('IntersectionObserver', Observer)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  authState.vrchat = 'authenticated'
  authState.chilloutvr = 'authenticated'
  useFriendsStore.setState({ platformFilter: 'all' })
  Reflect.deleteProperty(window, 'vrx')
})

const cardName = (item: AvatarItem): string =>
  msg('avatars.openAria', {
    name: item.name,
    platform: msg(item.platform === 'vrchat' ? 'dashboard.platformVrc' : 'dashboard.platformCvr')
  })

describe('AvatarsView', () => {
  it('shows both worn avatars side by side and one name-sorted uploads grid', async () => {
    renderView()
    await screen.findAllByRole('button', { name: cardName(cvrWorn) })
    await screen.findAllByRole('button', { name: cardName(vrcWorn) })
    const worn = screen.getByRole('region', { name: msg('avatars.wearingNow') })
    expect(
      within(worn)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label'))
    ).toEqual([cardName(vrcWorn), cardName(cvrWorn)])
    const uploads = screen.getByRole('region', { name: msg('avatars.yourUploads') })
    expect(
      within(uploads)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label'))
    ).toEqual([cardName(cvrWorn), cardName(cvrOther), cardName(vrcWorn), cardName(vrcOther)])
    expect(within(uploads).getByText(msg('avatars.uploadCount', { count: 4 }))).toBeTruthy()
  })

  it('reads only the platform the filter shows', async () => {
    useFriendsStore.setState({ platformFilter: 'chilloutvr' })
    renderView()
    await screen.findByRole('button', { name: cardName(cvrOther) })
    expect(bridge.getAvatarLibrary).toHaveBeenCalledTimes(1)
    expect(bridge.getAvatarLibrary).toHaveBeenCalledWith({ platform: 'chilloutvr' })
    expect(screen.queryByRole('button', { name: cardName(vrcOther) })).toBeNull()
  })

  it('shows the same connect notice for a signed-out platform and reads nothing for it', async () => {
    authState.chilloutvr = 'unauthenticated'
    renderView()
    await screen.findByRole('button', { name: cardName(vrcOther) })
    expect(screen.getByText(msg('avatars.notConnected.chilloutvr'))).toBeTruthy()
    expect(bridge.getAvatarLibrary).toHaveBeenCalledWith({ platform: 'vrchat' })
    expect(bridge.getAvatarLibrary).not.toHaveBeenCalledWith({ platform: 'chilloutvr' })
    fireEvent.click(screen.getByRole('button', { name: msg('avatars.notConnected.openAccounts') }))
    expect(useUiStore.getState().activeTab).toBe('settings')
    expect(useUiStore.getState().settingsCategory).toBe('accounts')
  })

  it('shows a typed failure with Try again', async () => {
    bridge.getAvatarLibrary.mockImplementation(({ platform }) =>
      Promise.resolve<AvatarLibraryResult>(
        platform === 'vrchat' ? { ok: false, reason: 'rate-limited' } : library(platform)
      )
    )
    renderView()
    const text = msg('avatars.error.rate-limited', { platform: msg('dashboard.platformVrc') })
    expect(await screen.findByText(text)).toBeTruthy()
    expect(screen.getByRole('button', { name: cardName(cvrOther) })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: msg('avatars.retry') }))
    await waitFor(() => expect(bridge.getAvatarLibrary).toHaveBeenCalledTimes(3))
  })

  it('opens the details sheet and wears an avatar', async () => {
    renderView()
    fireEvent.click(await screen.findByRole('button', { name: cardName(cvrOther) }))
    const sheet = screen.getByRole('dialog', {
      name: msg('avatars.sheet.aria', {
        name: cvrOther.name,
        platform: msg('dashboard.platformCvr')
      })
    })
    expect(await within(sheet).findByText(msg('avatars.details.private'))).toBeTruthy()
    fireEvent.click(
      within(sheet).getByRole('button', {
        name: msg('avatars.sheet.wearAria', {
          name: cvrOther.name,
          platform: msg('dashboard.platformCvr')
        })
      })
    )
    expect(
      await within(sheet).findByText(
        msg('avatars.sheet.switched', { platform: msg('dashboard.platformCvr') })
      )
    ).toBeTruthy()
    expect(bridge.switchAvatar).toHaveBeenCalledWith({
      platform: 'chilloutvr',
      avatarId: cvrOther.avatarId
    })
    expect(within(sheet).getByText(msg('avatars.sheet.wornNow'))).toBeTruthy()
    const worn = screen.getByRole('region', { name: msg('avatars.wearingNow') })
    expect(within(worn).getByRole('button', { name: cardName(cvrOther) })).toBeTruthy()
  })

  it('shows the sheet worn state instead of a Wear button for the worn avatar', async () => {
    renderView()
    await screen.findAllByRole('button', { name: cardName(vrcWorn) })
    const worn = screen.getByRole('region', { name: msg('avatars.wearingNow') })
    fireEvent.click(within(worn).getByRole('button', { name: cardName(vrcWorn) }))
    const sheet = screen.getByRole('dialog')
    expect(within(sheet).getByText(msg('avatars.sheet.wornNow'))).toBeTruthy()
    expect(within(sheet).queryByRole('button', { name: /wear/i })).toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() =>
      expect(document.activeElement?.getAttribute('aria-label')).toBe(cardName(vrcWorn))
    )
  })

  it('draws a big library in steps: the first screenful at once, then the rest', async () => {
    const many = Array.from({ length: UPLOADS_FIRST_STEP * 2 + 5 }, (_, index) =>
      avatar('vrchat', 100 + index, `Bulk ${String(index).padStart(3, '0')}`)
    )
    bridge.getAvatarLibrary.mockImplementation(({ platform }) =>
      Promise.resolve(
        platform === 'vrchat'
          ? { ok: true, platform, avatars: many, complete: true, current: null }
          : library(platform)
      )
    )
    renderView()
    const uploads = await screen.findByRole('region', { name: msg('avatars.yourUploads') })
    // The count names the whole library even before every card is drawn.
    expect(
      within(uploads).getByText(msg('avatars.uploadCount', { count: many.length + 2 }))
    ).toBeTruthy()
    await waitFor(() =>
      expect(within(uploads).getAllByRole('button')).toHaveLength(many.length + 2)
    )
  })

  it('keeps a loaded library when the page closes and opens again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const view = render(
      <QueryClientProvider client={client}>
        <AvatarsView />
      </QueryClientProvider>
    )
    await screen.findAllByRole('button', { name: cardName(vrcOther) })
    view.unmount()
    // Well past TanStack's default five unobserved minutes.
    vi.advanceTimersByTime(10 * 60_000)
    vi.useRealTimers()
    bridge.getAvatarLibrary.mockClear()
    render(
      <QueryClientProvider client={client}>
        <AvatarsView />
      </QueryClientProvider>
    )
    // Drawn from memory in the first render; the stale copy re-reads behind it.
    expect(screen.getAllByRole('button', { name: cardName(vrcOther) }).length).toBeGreaterThan(0)
  })
})
