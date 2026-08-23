// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Friend } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/settings'
import '../i18n'
import { useFriendsStore } from '../stores/friends'
import { useSettingsStore } from '../stores/settings'
import FriendsList from './FriendsList'

const useFriendsMock = vi.hoisted(() => vi.fn())
vi.mock('../queries/friends', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../queries/friends')>()),
  useFriends: useFriendsMock
}))
vi.mock('../queries/auth', () => ({
  useAuthStatus: (platform: 'vrchat' | 'chilloutvr') => ({
    data: {
      platform,
      state: 'authenticated',
      accountId: `${platform}-test`,
      displayName: 'Test User'
    }
  })
}))

const VIEWPORT_HEIGHT = 640
const MAIN_VIEWPORT_TOP = 16
const LIST_SCROLL_MARGIN = 224
const FRIEND_ROW_HEIGHT = 64
const FIRST_DETAIL_ROW_HEIGHT = 92
const SECTION_ROW_HEIGHT = 32

function measuredHeight(target: Element): number {
  if (target.tagName === 'MAIN') return VIEWPORT_HEIGHT
  if (target.getAttribute('data-virtual-kind') === 'section') return SECTION_ROW_HEIGHT
  if (target.getAttribute('data-friend-key') === 'vrchat:usr_0000') {
    return FIRST_DETAIL_ROW_HEIGHT
  }
  return FRIEND_ROW_HEIGHT
}

function rect(height: number, top = 0): DOMRect {
  return {
    x: 0,
    y: top,
    top,
    right: 800,
    bottom: top + height,
    left: 0,
    width: 800,
    height,
    toJSON: () => ({})
  }
}

function measuredTop(target: Element): number {
  if (target.tagName === 'MAIN') return MAIN_VIEWPORT_TOP
  if (target.id === 'friends-virtual-list') {
    const main = target.closest('main')
    return MAIN_VIEWPORT_TOP + LIST_SCROLL_MARGIN - (main?.scrollTop ?? 0)
  }
  return 0
}

class ResizeObserverStub {
  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element): void {
    const height = measuredHeight(target)
    this.callback(
      [
        {
          target,
          contentRect: rect(height),
          borderBoxSize: [{ blockSize: height, inlineSize: 800 }]
        } as unknown as ResizeObserverEntry
      ],
      this
    )
  }

  unobserve(target: Element): void {
    void target
  }
  disconnect(): void {
    void this.callback
  }
}

function makeFriend(index: number, state: Friend['presence']['state'] = 'in-game'): Friend {
  const number = index.toString().padStart(4, '0')
  return {
    platformUserId: `usr_${number}`,
    platform: 'vrchat',
    displayName: `Friend ${number}`,
    avatarUrl: null,
    presence: { state },
    status: 'online',
    statusDescription: null,
    trustRank: null,
    instance: null,
    isFavorite: false,
    favoriteGroupIds: [],
    linkedPersonId: null
  }
}

function opener(name: string): HTMLButtonElement {
  return screen.getByRole<HTMLButtonElement>('button', { name: new RegExp(`^${name}\\b`) })
}

let vrchatFriends: Friend[]
let chilloutvrFriends: Friend[]
let originalScrollTo: typeof HTMLElement.prototype.scrollTo | undefined

beforeEach(() => {
  vrchatFriends = Array.from({ length: 500 }, (_, index) => makeFriend(index))
  chilloutvrFriends = []
  useFriendsMock.mockImplementation((platform: string) => ({
    data: platform === 'vrchat' ? vrchatFriends : chilloutvrFriends,
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn()
  }))
  useFriendsStore.setState({ search: '', platformFilter: 'all', selectedFriendId: null })
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS, dirty: false })

  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement
  ) {
    return rect(measuredHeight(this), measuredTop(this))
  })

  originalScrollTo = HTMLElement.prototype.scrollTo
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value: function (this: HTMLElement, options: ScrollToOptions | number, y?: number): void {
      const nextTop =
        typeof options === 'number'
          ? (y ?? 0)
          : typeof options.top === 'number'
            ? options.top
            : this.scrollTop
      const previousTop = this.scrollTop
      this.scrollTop = nextTop
      if (nextTop !== previousTop) this.dispatchEvent(new Event('scroll'))
    }
  })
})

afterEach(() => {
  cleanup()
  useFriendsMock.mockReset()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  if (originalScrollTo === undefined) Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo')
  else HTMLElement.prototype.scrollTo = originalScrollTo
})

function renderInScrollContainer(): ReturnType<typeof render> {
  const view = render(
    <main style={{ height: VIEWPORT_HEIGHT, overflowY: 'auto' }}>
      <div data-testid="app-shell-topbar-offset" aria-hidden="true" />
      <FriendsList />
    </main>
  )
  const main = view.container.querySelector('main')
  if (main === null) throw new Error('missing test scroll container')
  // jsdom has no layout, so TanStack's max-offset calculation otherwise sees
  // 0 - 0 and correctly clamps every scrollToIndex call back to zero.
  Object.defineProperties(main, {
    clientHeight: { configurable: true, value: VIEWPORT_HEIGHT },
    scrollHeight: { configurable: true, value: 100_000 }
  })
  return view
}

function translateY(element: HTMLElement): number {
  const match = /translateY\(([-\d.]+)px\)/.exec(element.style.transform)
  if (match?.[1] === undefined) throw new Error('virtual row had no translateY position')
  return Number(match[1])
}

describe('FriendsList virtualization (VRX-63)', () => {
  it.each([500, 2000])('keeps a %i-friend roster to one visible DOM window', (count) => {
    vrchatFriends = Array.from({ length: count }, (_, index) => makeFriend(index))
    renderInScrollContainer()

    expect(screen.getByRole('list', { name: 'Friends' })).toBeTruthy()
    expect(screen.getByText('Friend 0000')).toBeTruthy()
    expect(screen.queryByText(`Friend ${(count - 1).toString().padStart(4, '0')}`)).toBeNull()
    expect(screen.getAllByRole('listitem').length).toBeLessThanOrEqual(25)
  })

  it('measures variable detail rows and uses a fixed compact-row stride', async () => {
    const view = renderInScrollContainer()
    await waitFor(() => {
      const first = view.container.querySelector<HTMLElement>('[data-friend-key="vrchat:usr_0000"]')
      const second = view.container.querySelector<HTMLElement>(
        '[data-friend-key="vrchat:usr_0001"]'
      )
      if (first === null || second === null) throw new Error('missing initial detail rows')
      expect(translateY(second) - translateY(first)).toBe(FIRST_DETAIL_ROW_HEIGHT + 4)
    })
    opener('Friend 0000').focus()

    act(() => {
      useSettingsStore.setState({
        settings: { ...DEFAULT_SETTINGS, density: 'compact' },
        dirty: false
      })
    })
    await waitFor(() => {
      const first = view.container.querySelector<HTMLElement>('[data-friend-key="vrchat:usr_0000"]')
      const second = view.container.querySelector<HTMLElement>(
        '[data-friend-key="vrchat:usr_0001"]'
      )
      if (first === null || second === null) throw new Error('missing live compact rows')
      expect(first.style.height).toBe('60px')
      expect(translateY(second) - translateY(first)).toBe(64)
      expect(document.activeElement).toBe(opener('Friend 0000'))
    })
  })

  it('uses one roving avatar stop and moves it with Up and Down arrows', async () => {
    const view = renderInScrollContainer()
    const main = view.container.querySelector('main')
    if (main === null) throw new Error('missing test scroll container')
    const first = opener('Friend 0000')
    const second = opener('Friend 0001')

    expect(first.tabIndex).toBe(0)
    expect(second.tabIndex).toBe(-1)

    // Let initial virtualizer measurements settle; arrow focus must not rely
    // on an unrelated post-mount rerender to drain the pending target.
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 50))
    })

    first.focus()
    fireEvent.keyDown(first, { key: 'ArrowDown' })

    await waitFor(() => expect(document.activeElement).toBe(opener('Friend 0001')))
    expect(opener('Friend 0000').tabIndex).toBe(-1)
    expect(opener('Friend 0001').tabIndex).toBe(0)

    fireEvent.keyDown(opener('Friend 0001'), { key: 'ArrowUp' })
    await waitFor(() => expect(document.activeElement).toBe(opener('Friend 0000')))

    // Cross the initial virtual window boundary: the target does not exist
    // until scrollToIndex updates the range and mounts its opener.
    for (let targetIndex = 1; targetIndex <= 24; targetIndex += 1) {
      const current = opener(`Friend ${(targetIndex - 1).toString().padStart(4, '0')}`)
      fireEvent.keyDown(current, { key: 'ArrowDown' })
      await waitFor(() =>
        expect(document.activeElement).toBe(
          opener(`Friend ${targetIndex.toString().padStart(4, '0')}`)
        )
      )
    }
    expect(main.scrollTop).toBeGreaterThan(0)
  })

  it('keeps the same scroll window when settled friend objects rerender', async () => {
    const view = renderInScrollContainer()
    const main = view.container.querySelector('main')
    if (main === null) throw new Error('missing test scroll container')

    act(() => {
      main.scrollTop = 900
      fireEvent.scroll(main)
    })
    await waitFor(() => expect(screen.queryByText('Friend 0000')).toBeNull())
    const visibleRovingStops = [
      ...view.container.querySelectorAll<HTMLButtonElement>(
        '[data-friend-key] > button[data-drawer-opener]'
      )
    ].filter((button) => button.tabIndex === 0)
    expect(visibleRovingStops).toHaveLength(1)
    const rovingRow = visibleRovingStops[0]?.closest<HTMLElement>('[data-friend-key]')
    if (rovingRow === null || rovingRow === undefined) {
      throw new Error('roving stop had no friend row')
    }
    expect(translateY(rovingRow)).toBeGreaterThanOrEqual(
      main.scrollTop - LIST_SCROLL_MARGIN + SECTION_ROW_HEIGHT + 4
    )
    expect(translateY(rovingRow)).toBeLessThan(
      main.scrollTop - LIST_SCROLL_MARGIN + VIEWPORT_HEIGHT
    )
    const activeHeaderRow = screen
      .getByRole('button', { name: /In-Game/ })
      .closest<HTMLElement>('[data-virtual-kind="section"]')
    expect(activeHeaderRow?.style.position).toBe('sticky')

    const visibleBefore = [...view.container.querySelectorAll<HTMLElement>('[data-friend-key]')]
      .map((row) => row.dataset.friendKey)
      .filter((key): key is string => key !== undefined)
    expect(visibleBefore.length).toBeGreaterThan(0)
    const anchorKey = visibleBefore[Math.floor(visibleBefore.length / 2)]
    if (anchorKey === undefined) throw new Error('virtual window had no anchor row')

    vrchatFriends = vrchatFriends.map((friend) => ({ ...friend }))
    view.rerender(
      <main style={{ height: VIEWPORT_HEIGHT, overflowY: 'auto' }}>
        <div data-testid="app-shell-topbar-offset" aria-hidden="true" />
        <FriendsList />
      </main>
    )

    expect(main.scrollTop).toBe(900)
    await waitFor(() => {
      const visibleAfter = new Set(
        [...view.container.querySelectorAll<HTMLElement>('[data-friend-key]')]
          .map((row) => row.dataset.friendKey)
          .filter((key): key is string => key !== undefined)
      )
      expect(visibleAfter.has(anchorKey)).toBe(true)
    })
  })

  it('hands focus to the visible roving opener when pointer scrolling unmounts its row', async () => {
    const view = renderInScrollContainer()
    const main = view.container.querySelector('main')
    if (main === null) throw new Error('missing test scroll container')
    opener('Friend 0000').focus()

    act(() => {
      main.scrollTop = 900
      fireEvent.scroll(main)
    })

    await waitFor(() => expect(screen.queryByText('Friend 0000')).toBeNull())
    await waitFor(() => {
      const visibleStop = view.container.querySelector<HTMLButtonElement>(
        '[data-friend-key] > button[data-drawer-opener][tabindex="0"]'
      )
      expect(visibleStop).not.toBeNull()
      expect(document.activeElement).toBe(visibleStop)
    })
  })

  it('uses the AppShell list offset while advancing the sticky section header', async () => {
    vrchatFriends = [
      ...Array.from({ length: 12 }, (_, index) => makeFriend(index, 'in-game')),
      ...Array.from({ length: 12 }, (_, index) => makeFriend(index + 12, 'active'))
    ]
    const view = renderInScrollContainer()
    const main = view.container.querySelector('main')
    if (main === null) throw new Error('missing test scroll container')

    act(() => {
      main.scrollTop = 1_120
      fireEvent.scroll(main)
    })

    await waitFor(() => {
      const onlineHeaderRow = screen
        .getByRole('button', { name: /Online \(12\)/ })
        .closest<HTMLElement>('[data-virtual-kind="section"]')
      expect(onlineHeaderRow?.style.position).toBe('sticky')
    })
    const visibleStop = view.container.querySelector<HTMLButtonElement>(
      '[data-friend-key] > button[data-drawer-opener][tabindex="0"]'
    )
    const visibleRow = visibleStop?.closest<HTMLElement>('[data-friend-key]')
    if (visibleRow === null || visibleRow === undefined) {
      throw new Error('offset viewport had no visible roving row')
    }
    expect(visibleRow.dataset.friendKey).toBe('vrchat:usr_0013')
    expect(translateY(visibleRow)).toBeGreaterThanOrEqual(
      main.scrollTop - LIST_SCROLL_MARGIN + SECTION_ROW_HEIGHT + 4
    )
    expect(translateY(visibleRow)).toBeLessThan(
      main.scrollTop - LIST_SCROLL_MARGIN + VIEWPORT_HEIGHT
    )
  })
})
