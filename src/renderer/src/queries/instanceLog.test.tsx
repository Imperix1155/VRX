// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor, type RenderHookResult } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  INSTANCE_VISIT_PAGE_SIZE,
  type InstanceVisit,
  type InstanceVisitPage,
  type InstanceVisitPageRequest
} from '@shared/instanceLog'
import { DEFAULT_SETTINGS } from '@shared/settings'
import type { Platform } from '@shared/types'
import { useSettingsStore } from '../stores/settings'
import {
  instanceLogKey,
  mergeVisits,
  useInstanceVisits,
  type InstanceVisitsView
} from './instanceLog'

const PAGE = INSTANCE_VISIT_PAGE_SIZE
const VRCHAT: Platform[] = ['vrchat']

/** The newest saved visit; visit `n` was entered at moment `n`. */
let newest: number
let boundary: (() => void) | undefined
let client: QueryClient
let getInstanceVisits: ReturnType<
  typeof vi.fn<(request: InstanceVisitPageRequest) => Promise<InstanceVisitPage>>
>

const visit = (id: number, platform: Platform = 'vrchat'): InstanceVisit => ({
  id,
  platform,
  worldName: `World ${id}`,
  enteredAt: id,
  leftAt: id,
  current: false,
  people: 0
})

/** Main's answer: the newest page before the cursor, newest first. */
function page(request: InstanceVisitPageRequest): InstanceVisitPage {
  const before = request.scope[0]?.before ?? newest + 1
  const visits: InstanceVisit[] = []
  for (let id = Math.min(before - 1, newest); id >= 1 && visits.length < PAGE; id -= 1) {
    visits.push(visit(id))
  }
  const last = visits.at(-1)
  return { visits, hasMore: last !== undefined && last.id > 1 }
}

const wrapper = ({ children }: { children: ReactNode }): React.JSX.Element => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
)

const shownIds = (visits: readonly InstanceVisit[]): number[] => visits.map((shown) => shown.id)
const range = (from: number, to: number): number[] =>
  Array.from({ length: from - to + 1 }, (_, index) => from - index)

/** Main's change notice: every instance log view reads again. */
async function changed(): Promise<void> {
  await act(() => client.invalidateQueries({ queryKey: instanceLogKey }))
}

beforeEach(() => {
  newest = 3 * PAGE
  boundary = undefined
  client = new QueryClient()
  getInstanceVisits = vi.fn(async (request) => page(request))
  ;(window as unknown as { vrx?: unknown }).vrx = {
    getInstanceVisits,
    onIdentityBoundary: (listener: () => void) => {
      boundary = listener
      return () => {
        boundary = undefined
      }
    }
  }
})

afterEach(() => {
  cleanup()
  client.clear()
  ;(window as unknown as { vrx?: unknown }).vrx = undefined
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS, dirty: false, saveError: false })
})

describe('mergeVisits', () => {
  it('lists a visit once, in the form of the first list that holds it, newest first', () => {
    const fresh = { ...visit(2), people: 4 }
    expect(mergeVisits([fresh], new Map([['a', visit(2)]]).values(), [visit(3), visit(1)])).toEqual(
      [visit(3), fresh, visit(1)]
    )
  })
})

describe('useInstanceVisits', () => {
  async function withOlderPageShown(): Promise<RenderHookResult<InstanceVisitsView, unknown>> {
    const view = renderHook(() => useInstanceVisits(VRCHAT, true), { wrapper })
    await waitFor(() => expect(view.result.current.ready).toBe(true))
    act(() => view.result.current.showOlder())
    await waitFor(() => expect(view.result.current.visits).toHaveLength(2 * PAGE))
    expect(shownIds(view.result.current.visits)).toEqual(range(newest, newest - 2 * PAGE + 1))
    return view
  }

  it('keeps every visit listed when new ones arrive under an older page', async () => {
    const view = await withOlderPageShown()
    const oldest = newest - 2 * PAGE + 1

    // Each new visit pushes one off the refreshed first page.
    for (let arrived = 1; arrived <= 3; arrived += 1) {
      newest += 1
      await changed()
      await waitFor(() => expect(view.result.current.visits[0]?.id).toBe(newest))
      expect(shownIds(view.result.current.visits)).toEqual(range(newest, oldest))
    }

    // Show older continues below the oldest visit shown, with no gap.
    act(() => view.result.current.showOlder())
    await waitFor(() => expect(view.result.current.visits).toHaveLength(3 * PAGE + 3))
    expect(shownIds(view.result.current.visits)).toEqual(range(newest, oldest - PAGE))
  })

  it('shows a refreshed visit in its newest form', async () => {
    const view = await withOlderPageShown()
    const was = newest
    getInstanceVisits.mockImplementation(async (request) => {
      const answer = page(request)
      return {
        ...answer,
        visits: answer.visits.map((shown) => (shown.id === was ? { ...shown, people: 7 } : shown))
      }
    })
    newest += 1
    await changed()
    await waitFor(() => expect(view.result.current.visits[0]?.id).toBe(newest))
    expect(view.result.current.visits.find((shown) => shown.id === was)?.people).toBe(7)
  })

  it('drops the visits it kept when the view starts over (a Clear, a restore)', async () => {
    const view = await withOlderPageShown()
    newest += 1
    await changed()
    await waitFor(() => expect(view.result.current.visits).toHaveLength(2 * PAGE + 1))

    // Everything saved was cleared; one new visit came after.
    newest = 1
    act(() => view.result.current.startOver())
    await waitFor(() => expect(shownIds(view.result.current.visits)).toEqual([1]))
    expect(view.result.current.canShowOlder).toBe(false)
  })

  it('drops the visits it kept when an account changes', async () => {
    const view = await withOlderPageShown()
    newest += 1
    await changed()
    await waitFor(() => expect(view.result.current.visits).toHaveLength(2 * PAGE + 1))

    newest = 2
    act(() => boundary?.())
    await waitFor(() => expect(shownIds(view.result.current.visits)).toEqual([2, 1]))
  })

  it('drops the visits it kept once main applied another Kept choice, not before', async () => {
    const view = renderHook(() => useInstanceVisits(VRCHAT, true), { wrapper })
    await waitFor(() => expect(view.result.current.ready).toBe(true))
    newest += 1
    await changed()
    await waitFor(() => expect(view.result.current.visits).toHaveLength(PAGE + 1))

    // Picked here: main still holds every visit, so nothing changes yet.
    act(() => useSettingsStore.getState().updateSettings({ activityKeepFor: 'session' }))
    expect(view.result.current.visits).toHaveLength(PAGE + 1)

    // Main applied it and deleted the saved log, then the save answered.
    newest = 0
    await changed()
    act(() => useSettingsStore.getState().markSaved())
    await waitFor(() => expect(view.result.current.ready).toBe(true))
    await waitFor(() => expect(view.result.current.visits).toEqual([]))
  })

  it('drops the visits it kept when the platforms shown change', async () => {
    let platforms: Platform[] = VRCHAT
    const view = renderHook(() => useInstanceVisits(platforms, true), { wrapper })
    await waitFor(() => expect(view.result.current.ready).toBe(true))
    newest += 1
    await changed()
    await waitFor(() => expect(view.result.current.visits).toHaveLength(PAGE + 1))

    getInstanceVisits.mockImplementation(async () => ({
      visits: [visit(5, 'chilloutvr')],
      hasMore: false
    }))
    platforms = ['chilloutvr']
    view.rerender()
    await waitFor(() =>
      expect(view.result.current.visits.map((shown) => shown.platform)).toEqual(['chilloutvr'])
    )
  })
})
