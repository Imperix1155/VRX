// @vitest-environment jsdom
/**
 * Search and Explore's New / Recently updated lists hand out worlds that never
 * appear in Popular now, so an expired reference must be renewed from the
 * results the card came from (Codex, 2026-10-31).
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExploreWorld } from '@shared/explore'
import { useExploreWorldSelection } from './useExploreWorldSelection'

const readExploreSnapshot = vi.hoisted(() => vi.fn())
vi.mock('../queries/explore', () => ({
  readExploreSnapshot,
  observeExploreImage: () => () => undefined
}))

function world(worldRef: string): ExploreWorld {
  return {
    platform: 'chilloutvr',
    worldId: 'cvr-world-1',
    worldRef,
    name: 'Plaza',
    authorName: null,
    occupants: null
  } as unknown as ExploreWorld
}

afterEach(() => {
  vi.clearAllMocks()
  Reflect.deleteProperty(window, 'vrx')
})

describe('useExploreWorldSelection with its own recovery', () => {
  it('renews an expired reference from the given results and reopens the sheet', async () => {
    const snapshot = { platform: 'chilloutvr', world: { worldId: 'cvr-world-1' } }
    const getExploreWorld = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(snapshot)
    Object.defineProperty(window, 'vrx', {
      value: { getExploreWorld, cancelExploreWorld: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
      writable: true
    })
    const recover = vi.fn().mockResolvedValue([world('ref-new')])
    const { result } = renderHook(() => useExploreWorldSelection('all', recover))
    act(() => result.current.open(world('ref-old'), document.body))
    await waitFor(() => expect(result.current.sheet).toBe(snapshot))
    expect(recover).toHaveBeenCalledWith('chilloutvr')
    expect(readExploreSnapshot).not.toHaveBeenCalled()
    expect(getExploreWorld).toHaveBeenLastCalledWith({
      platform: 'chilloutvr',
      worldRef: 'ref-new',
      reason: 'open'
    })
  })
})
