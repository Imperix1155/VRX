// @vitest-environment jsdom
import { fireEvent, render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ExplorePlatformSnapshot,
  ExploreRoom,
  ExploreWorld,
  ExploreWorldSnapshot
} from '@shared/explore'
import { rankExploreWorlds, selectExploreWorlds } from '@shared/exploreRanking'
import '../i18n'
import ExploreDashboardPreview from './ExploreDashboardPreview'
import ExploreDashboardComposition from './ExploreDashboardComposition'
import ExploreView from './ExploreView'
import ExploreWorldSheet from './ExploreWorldSheet'

const complete = (
  value: number
): { state: 'complete'; value: number; source: 'visible-rooms' } => ({
  state: 'complete',
  value,
  source: 'visible-rooms'
})
function world(
  platform: 'vrchat' | 'chilloutvr',
  id: string,
  name = 'A very long world title that remains readable'
): ExploreWorld {
  return {
    platform,
    worldId: id,
    worldRef: `ref-${id}`,
    name,
    thumbnailUrl: null,
    activity: complete(7),
    visibleRoomCount: complete(1),
    popularity: null,
    sourceOrder: 0
  }
}
function source(
  platform: 'vrchat' | 'chilloutvr',
  worlds: readonly ExploreWorld[],
  status: ExplorePlatformSnapshot['status'] = 'ready'
): ExplorePlatformSnapshot {
  return { platform, worlds, status, problem: null, isStale: false, updatedAt: null }
}
function room(
  platform: 'vrchat' | 'chilloutvr',
  action: ExploreRoom['action'],
  worldId = 'world'
): ExploreRoom {
  return {
    platform,
    worldId,
    roomId: 'room',
    access: 'public',
    region: null,
    groupName: null,
    occupancy: complete(20),
    capacity: 20,
    full: true,
    action
  }
}
function setup(
  overrides: Partial<React.ComponentProps<typeof ExploreView>> = {}
): React.ComponentProps<typeof ExploreView> {
  const worlds = [world('vrchat', 'vrc'), world('chilloutvr', 'cvr')]
  const props: React.ComponentProps<typeof ExploreView> = {
    worlds,
    total: 4,
    platformSnapshots: [source('vrchat', [worlds[0]!]), source('chilloutvr', [worlds[1]!])],
    sheet: null,
    sheetOpener: null,
    focusFallback: null,
    onTotalChange: vi.fn(),
    onOpenWorld: vi.fn(),
    onCloseSheet: vi.fn(),
    onJoinRoom: vi.fn(),
    ...overrides
  }
  render(<ExploreView {...props} />)
  return props
}

afterEach(cleanup)

describe('ExploreView', () => {
  it('uses the compact controlled 2/4/6 stepper without owning the platform filter', () => {
    const props = setup()
    const spin = screen.getByRole('spinbutton', { name: 'Worlds shown' })
    expect(spin.getAttribute('aria-valuemin')).toBe('2')
    expect(spin.getAttribute('aria-valuemax')).toBe('6')
    fireEvent.keyDown(spin, { key: 'ArrowUp' })
    expect(props.onTotalChange).toHaveBeenCalledWith(6)
    expect(screen.queryByRole('tablist')).toBeNull()
  })

  it('keeps the Worlds shown stepper at its 2 and 6 limits', () => {
    const low = setup({ total: 2 })
    expect(screen.getByRole('button', { name: 'Decrease' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Increase' }))
    expect(low.onTotalChange).toHaveBeenCalledWith(4)
    cleanup()
    const high = setup({ total: 6 })
    expect(screen.getByRole('button', { name: 'Increase' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Decrease' }))
    expect(high.onTotalChange).toHaveBeenCalledWith(4)
  })

  it('opens cards through the injected callback and never uses their source thumbnail URL', () => {
    const selected = world('vrchat', 'vrc', 'World')
    const props = setup({ worlds: [selected] })
    fireEvent.click(screen.getByRole('button', { name: /open visible rooms/i }))
    expect(props.onOpenWorld).toHaveBeenCalledWith(selected, expect.any(HTMLButtonElement))
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('shows unknown rather than zero for partial counts and reports stale sources', () => {
    const partial = {
      ...world('vrchat', 'partial'),
      activity: { state: 'partial' as const, value: null, source: 'unknown' as const }
    }
    setup({
      worlds: [partial],
      platformSnapshots: [{ ...source('vrchat', [partial]), isStale: true }]
    })
    expect(screen.getByText(/People in this world: Unknown/)).toBeTruthy()
    expect(screen.getByText('VRChat is showing saved results while refreshing.')).toBeTruthy()
  })

  it('names independent source states and retains healthy cards without an ordinary empty result', () => {
    const healthy = world('vrchat', 'healthy', 'Healthy World')
    setup({
      worlds: [healthy],
      platformSnapshots: [source('vrchat', [healthy], 'loading'), source('chilloutvr', [], 'error')]
    })
    expect(screen.getByText('VRChat worlds are loading…')).toBeTruthy()
    expect(screen.getByText('ChilloutVR worlds could not load.')).toBeTruthy()
    expect(screen.getByText('Healthy World')).toBeTruthy()
    expect(screen.queryByText('No public worlds are available right now.')).toBeNull()
  })

  it('does not present ordinary empty copy when every source is unavailable', () => {
    setup({
      worlds: [],
      platformSnapshots: [source('vrchat', [], 'unavailable'), source('chilloutvr', [], 'error')]
    })
    expect(screen.getByText('VRChat discovery is unavailable.')).toBeTruthy()
    expect(screen.queryByText('No public worlds are available right now.')).toBeNull()
  })

  it('removes failed injected card images without consulting a fallback source', () => {
    const selected = world('vrchat', 'image', 'Image World')
    setup({ worlds: [selected], images: { [selected.worldRef]: 'synthetic://broken' } })
    const image = document.querySelector('img')
    expect(image?.getAttribute('src')).toBe('synthetic://broken')
    fireEvent.error(image!)
    expect(document.querySelector('img')).toBeNull()
  })

  it('keeps CVR full public rooms enabled when main supplied an available action', () => {
    const selected = world('chilloutvr', 'cvr', 'CVR World')
    const snapshot: ExploreWorldSnapshot = {
      ...source('chilloutvr', [selected]),
      world: selected,
      rooms: [
        room('chilloutvr', { state: 'available', selectionRef: 'synthetic' }, selected.worldId)
      ],
      roomsComplete: true
    }
    const props = setup({ worlds: [selected], sheet: snapshot })
    expect(screen.getByRole('button', { name: 'Join' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Join' }))
    expect(props.onJoinRoom).toHaveBeenCalledWith(snapshot.rooms[0])
  })

  it('disables restricted room actions, closes on Escape, and focuses Close on open', () => {
    const selected = world('vrchat', 'vrc', 'VRC World')
    const snapshot: ExploreWorldSnapshot = {
      ...source('vrchat', [selected]),
      world: selected,
      rooms: [room('vrchat', { state: 'disabled', reason: 'restricted' }, selected.worldId)],
      roomsComplete: false
    }
    const props = setup({ worlds: [selected], sheet: snapshot })
    const close = screen.getByRole('button', { name: 'Close' })
    expect(document.activeElement).toBe(close)
    expect(screen.getByRole('button', { name: 'Restricted' }).hasAttribute('disabled')).toBe(true)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(props.onCloseSheet).toHaveBeenCalledTimes(1)
  })

  it('never activates an otherwise available matching room action from a stale snapshot', () => {
    const selected = world('vrchat', 'vrc', 'VRC World')
    const stale: ExploreWorldSnapshot = {
      ...source('vrchat', [selected]),
      isStale: true,
      world: selected,
      rooms: [room('vrchat', { state: 'available', selectionRef: 'synthetic' }, selected.worldId)],
      roomsComplete: true
    }
    const props = setup({ worlds: [selected], sheet: stale })
    const unavailable = screen.getByRole('button', { name: 'Unavailable' })
    expect(unavailable.hasAttribute('disabled')).toBe(true)
    fireEvent.click(unavailable)
    expect(props.onJoinRoom).not.toHaveBeenCalled()
  })

  it('never activates a fresh room row that belongs to another world', () => {
    const selected = world('vrchat', 'vrc', 'VRC World')
    const fresh: ExploreWorldSnapshot = {
      ...source('vrchat', [selected]),
      world: selected,
      rooms: [room('vrchat', { state: 'available', selectionRef: 'synthetic' }, 'other-world')],
      roomsComplete: true
    }
    const props = setup({ worlds: [selected], sheet: fresh })
    fireEvent.click(screen.getByRole('button', { name: 'Unavailable' }))
    expect(props.onJoinRoom).not.toHaveBeenCalled()
  })

  it('keeps cached error rows visible but disabled with an honest error', () => {
    const selected = world('vrchat', 'vrc', 'VRC World')
    const errored: ExploreWorldSnapshot = {
      ...source('vrchat', [selected], 'error'),
      world: selected,
      rooms: [room('vrchat', { state: 'available', selectionRef: 'synthetic' }, selected.worldId)],
      roomsComplete: false
    }
    const props = setup({ worlds: [selected], sheet: errored })
    expect(screen.getByText('Visible public rooms could not load.')).toBeTruthy()
    const unavailable = screen.getByRole('button', { name: 'Unavailable' })
    expect(unavailable.hasAttribute('disabled')).toBe(true)
    fireEvent.click(unavailable)
    expect(props.onJoinRoom).not.toHaveBeenCalled()
  })

  it('shows an unavailable room state instead of an empty result', () => {
    const selected = world('chilloutvr', 'cvr', 'CVR World')
    const unavailable: ExploreWorldSnapshot = {
      ...source('chilloutvr', [], 'unavailable'),
      world: selected,
      rooms: [],
      roomsComplete: false
    }
    setup({ worlds: [selected], sheet: unavailable })
    expect(screen.getByText('Visible public rooms are unavailable.')).toBeTruthy()
    expect(screen.queryByText('No visible public rooms are available.')).toBeNull()
  })

  it('removes failed injected sheet images to the neutral image layer', () => {
    const selected = world('vrchat', 'vrc', 'VRC World')
    const snapshot: ExploreWorldSnapshot = {
      ...source('vrchat', [selected]),
      world: selected,
      rooms: [],
      roomsComplete: true
    }
    render(
      <ExploreWorldSheet
        snapshot={snapshot}
        image="synthetic://broken-sheet"
        opener={null}
        focusFallback={null}
        onClose={vi.fn()}
        onJoin={vi.fn()}
      />
    )
    fireEvent.error(document.querySelector('img')!)
    expect(document.querySelector('img')).toBeNull()
  })

  it('returns focus to the opener after its parent dismisses the nonmodal sheet', () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const selected = world('vrchat', 'vrc', 'VRC World')
    const snapshot: ExploreWorldSnapshot = {
      ...source('vrchat', [selected]),
      world: selected,
      rooms: [],
      roomsComplete: true
    }
    const { rerender } = render(
      <ExploreWorldSheet
        snapshot={snapshot}
        opener={opener}
        focusFallback={null}
        onClose={vi.fn()}
        onJoin={vi.fn()}
      />
    )
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }))
    rerender(
      <ExploreWorldSheet
        snapshot={null}
        opener={opener}
        focusFallback={null}
        onClose={vi.fn()}
        onJoin={vi.fn()}
      />
    )
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('uses the latest supplied opener and connected fallback when the opener disappears', () => {
    const first = document.createElement('button')
    const latest = document.createElement('button')
    const fallback = document.createElement('main')
    fallback.tabIndex = -1
    document.body.append(first, latest, fallback)
    const firstWorld = world('vrchat', 'first', 'First')
    const secondWorld = world('chilloutvr', 'second', 'Second')
    const firstSnapshot: ExploreWorldSnapshot = {
      ...source('vrchat', [firstWorld]),
      world: firstWorld,
      rooms: [],
      roomsComplete: true
    }
    const secondSnapshot: ExploreWorldSnapshot = {
      ...source('chilloutvr', [secondWorld]),
      world: secondWorld,
      rooms: [],
      roomsComplete: true
    }
    const { rerender } = render(
      <ExploreWorldSheet
        snapshot={firstSnapshot}
        opener={first}
        focusFallback={fallback}
        onClose={vi.fn()}
        onJoin={vi.fn()}
      />
    )
    rerender(
      <ExploreWorldSheet
        snapshot={secondSnapshot}
        opener={latest}
        focusFallback={fallback}
        onClose={vi.fn()}
        onJoin={vi.fn()}
      />
    )
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBeNull()
    latest.remove()
    rerender(
      <ExploreWorldSheet
        snapshot={null}
        opener={latest}
        focusFallback={fallback}
        onClose={vi.fn()}
        onJoin={vi.fn()}
      />
    )
    expect(document.activeElement).toBe(fallback)
    first.remove()
    fallback.remove()
  })

  it('returns to a connected latest opener after an in-place world switch', () => {
    const first = document.createElement('button')
    const latest = document.createElement('button')
    document.body.append(first, latest)
    const one = world('vrchat', 'one')
    const two = world('chilloutvr', 'two')
    const firstSnapshot: ExploreWorldSnapshot = {
      ...source('vrchat', [one]),
      world: one,
      rooms: [],
      roomsComplete: true
    }
    const secondSnapshot: ExploreWorldSnapshot = {
      ...source('chilloutvr', [two]),
      world: two,
      rooms: [],
      roomsComplete: true
    }
    const { rerender } = render(
      <ExploreWorldSheet
        snapshot={firstSnapshot}
        opener={first}
        focusFallback={null}
        onClose={vi.fn()}
        onJoin={vi.fn()}
      />
    )
    rerender(
      <ExploreWorldSheet
        snapshot={secondSnapshot}
        opener={latest}
        focusFallback={null}
        onClose={vi.fn()}
        onJoin={vi.fn()}
      />
    )
    rerender(
      <ExploreWorldSheet
        snapshot={null}
        opener={latest}
        focusFallback={null}
        onClose={vi.fn()}
        onJoin={vi.fn()}
      />
    )
    expect(document.activeElement).toBe(latest)
    first.remove()
    latest.remove()
  })

  it('keeps sheet focus during a fallback change and still uses the latest opener on close', () => {
    const first = document.createElement('button')
    const latest = document.createElement('button')
    const fallback = document.createElement('main')
    fallback.tabIndex = -1
    document.body.append(first, latest, fallback)
    const one = world('vrchat', 'one')
    const two = world('chilloutvr', 'two')
    const firstSnapshot: ExploreWorldSnapshot = {
      ...source('vrchat', [one]),
      world: one,
      rooms: [],
      roomsComplete: true
    }
    const secondSnapshot: ExploreWorldSnapshot = {
      ...source('chilloutvr', [two]),
      world: two,
      rooms: [],
      roomsComplete: true
    }
    const { rerender } = render(
      <ExploreWorldSheet
        snapshot={firstSnapshot}
        opener={first}
        focusFallback={null}
        onClose={vi.fn()}
        onJoin={vi.fn()}
      />
    )
    const close = screen.getByRole('button', { name: 'Close' })
    rerender(
      <ExploreWorldSheet
        snapshot={firstSnapshot}
        opener={first}
        focusFallback={fallback}
        onClose={vi.fn()}
        onJoin={vi.fn()}
      />
    )
    expect(document.activeElement).toBe(close)
    rerender(
      <ExploreWorldSheet
        snapshot={secondSnapshot}
        opener={latest}
        focusFallback={fallback}
        onClose={vi.fn()}
        onJoin={vi.fn()}
      />
    )
    rerender(
      <ExploreWorldSheet
        snapshot={null}
        opener={latest}
        focusFallback={fallback}
        onClose={vi.fn()}
        onJoin={vi.fn()}
      />
    )
    expect(document.activeElement).toBe(latest)
    first.remove()
    latest.remove()
    fallback.remove()
  })
})

describe('ExploreDashboardPreview', () => {
  it('caps a shared selection at two cards', () => {
    const worlds = [world('vrchat', '1'), world('chilloutvr', '2'), world('vrchat', '3')]
    render(<ExploreDashboardPreview worlds={worlds} onOpenWorld={vi.fn()} />)
    expect(screen.getAllByRole('button', { name: /open visible rooms/i })).toHaveLength(2)
  })

  it('composes its two cards from the same ranked lists and neutral seeds as Explore', () => {
    const lists = {
      vrchat: rankExploreWorlds('vrchat', [world('vrchat', 'v1'), world('vrchat', 'v2')]),
      chilloutvr: rankExploreWorlds('chilloutvr', [
        world('chilloutvr', 'c1'),
        world('chilloutvr', 'c2')
      ])
    }
    const listSeeds = { vrchat: 17, chilloutvr: 29 }
    const explore = selectExploreWorlds({ lists, filter: 'all', total: 4, listSeeds })
    const dashboard = selectExploreWorlds({ lists, filter: 'all', total: 2, listSeeds })
    render(<ExploreDashboardPreview worlds={dashboard} onOpenWorld={vi.fn()} />)
    expect(dashboard).toEqual(explore.slice(0, 2))
    expect(screen.getAllByRole('button', { name: /open visible rooms/i })).toHaveLength(2)
  })

  it('keeps supplied stats and Hot Instances nodes around the shared preview across totals and filters', () => {
    const lists = {
      vrchat: rankExploreWorlds('vrchat', [world('vrchat', 'v1'), world('vrchat', 'v2')]),
      chilloutvr: rankExploreWorlds('chilloutvr', [
        world('chilloutvr', 'c1'),
        world('chilloutvr', 'c2')
      ])
    }
    const seeds = { vrchat: 17, chilloutvr: 29 }
    const hotAction = vi.fn()
    const stats = <div data-testid="stats">stats</div>
    const hot = (
      <button type="button" onClick={hotAction}>
        Hot Instances
      </button>
    )
    for (const total of [2, 4, 6] as const) {
      const preview = selectExploreWorlds({
        lists,
        filter: total === 6 ? 'vrchat' : 'all',
        total,
        listSeeds: seeds
      })
      const { unmount } = render(
        <ExploreDashboardComposition
          stats={stats}
          hotInstances={hot}
          preview={{ worlds: preview, onOpenWorld: vi.fn() }}
        />
      )
      const order = Array.from(document.body.textContent ?? '')
      expect(order.join('')).toMatch(/stats[\s\S]*Popular now[\s\S]*Hot Instances/)
      expect(screen.getAllByRole('button', { name: /open visible rooms/i })).toHaveLength(
        Math.min(2, preview.length)
      )
      fireEvent.click(screen.getByRole('button', { name: 'Hot Instances' }))
      unmount()
    }
    expect(hotAction).toHaveBeenCalledTimes(3)
  })
})
