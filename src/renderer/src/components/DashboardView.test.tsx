// @vitest-environment jsdom
/**
 * DashboardView state tests (audit W5).
 *
 * Pins the load/error contract added in W5: with no cached data an outage must
 * show an explicit error — never the misleading "0 / 0 / 0" stat cards — and an
 * in-flight initial load must show "loading". Partial data (one platform up)
 * renders normally.
 *
 * The queries module is mocked at the hook seam (per the render-check recipe):
 * DashboardView consumes only { data, isPending } from useFriends.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { Friend, VrcFriend } from '@shared/types'
import i18n from '../i18n'
import DashboardView from './DashboardView'

const useFriendsMock = vi.hoisted(() => vi.fn())
vi.mock('../queries/friends', () => ({ useFriends: useFriendsMock }))

// Assertions go through i18n.t so a copy tweak doesn't break behavior tests.
const msg = (key: string, opts?: Record<string, unknown>): string => i18n.t(key, opts)

type QueryStub = {
  data: Friend[] | undefined
  isPending: boolean
  refetch?: ReturnType<typeof vi.fn>
}

function stubQueries(vrc: QueryStub, cvr: QueryStub): void {
  useFriendsMock.mockImplementation((platform: string) => (platform === 'vrchat' ? vrc : cvr))
}

function makeFriend(overrides: Partial<VrcFriend> = {}): Friend {
  const base: VrcFriend = {
    platform: 'vrchat',
    platformUserId: 'usr_1',
    displayName: 'Alice',
    avatarUrl: null,
    presence: { state: 'in-game' },
    status: 'online',
    statusDescription: null,
    trustRank: 'known',
    instance: null,
    isFavorite: false,
    favoriteGroupIds: [],
    linkedPersonId: null
  }
  return { ...base, ...overrides }
}

afterEach(() => {
  cleanup()
  useFriendsMock.mockReset()
})

describe('DashboardView states (W5)', () => {
  it('shows loading (not 0/0/0) while both queries are pending with no data', () => {
    stubQueries({ data: undefined, isPending: true }, { data: undefined, isPending: true })
    render(<DashboardView />)
    expect(screen.getByText(msg('dashboard.loading'))).toBeTruthy()
    expect(screen.queryByText(msg('dashboard.statOnlineLabel'))).toBeNull() // no stat cards
  })

  it('keeps showing loading while one platform is still pending and none has data', () => {
    stubQueries({ data: undefined, isPending: false }, { data: undefined, isPending: true })
    render(<DashboardView />)
    expect(screen.getByText(msg('dashboard.loading'))).toBeTruthy()
  })

  it('shows an error (not "no friends online") when everything failed with no data', () => {
    stubQueries({ data: undefined, isPending: false }, { data: undefined, isPending: false })
    render(<DashboardView />)
    expect(screen.getByText(msg('dashboard.error'))).toBeTruthy()
    expect(screen.queryByText(msg('dashboard.emptyHeading'))).toBeNull()
  })

  it('offers a retry in the error state that refetches both platforms', () => {
    const vrcRefetch = vi.fn()
    const cvrRefetch = vi.fn()
    stubQueries(
      { data: undefined, isPending: false, refetch: vrcRefetch },
      { data: undefined, isPending: false, refetch: cvrRefetch }
    )
    render(<DashboardView />)
    fireEvent.click(screen.getByRole('button', { name: msg('dashboard.retry') }))
    expect(vrcRefetch).toHaveBeenCalledTimes(1)
    expect(cvrRefetch).toHaveBeenCalledTimes(1)
  })

  it('renders stats from partial data when one platform errored', () => {
    stubQueries(
      { data: [makeFriend()], isPending: false },
      { data: undefined, isPending: false } // CVR failed — VRC data still renders
    )
    render(<DashboardView />)
    expect(screen.getByText(msg('dashboard.statOnlineLabel'))).toBeTruthy()
    // onlineCount and inGameCount both = 1 (the single in-game friend)
    expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(2)
  })

  it('labels the hot-instances section with its heading (landmark, W5)', () => {
    stubQueries({ data: [makeFriend()], isPending: false }, { data: [], isPending: false })
    render(<DashboardView />)
    const heading = screen.getByRole('heading', { name: msg('dashboard.sectionHotInstances') })
    expect(heading.id).toBe('dashboard-hot-heading')
  })
})
