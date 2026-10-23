import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const screen = vi.hoisted(() => ({
  listeners: new Map<string, Set<() => void>>(),
  on(event: string, listener: () => void): void {
    const set = this.listeners.get(event) ?? new Set()
    set.add(listener)
    this.listeners.set(event, set)
  },
  removeListener(event: string, listener: () => void): void {
    this.listeners.get(event)?.delete(listener)
  },
  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0
  },
  getDisplayMatching: vi.fn(() => ({ workAreaSize: { width: 1920, height: 1040 } }))
}))
vi.mock('electron', () => ({ screen }))

import { keepMinimumSizeOnScreen, minimumSizeFor } from './windowMinimumSize'

type Rect = { x: number; y: number; width: number; height: number }

/** A window sized by its content: a 900x670 page inside a 16x39 frame. */
class FakeWindow extends EventEmitter {
  setMinimumSize = vi.fn()
  minimized = false
  outer: Rect = { x: 0, y: 0, width: 916, height: 709 }
  content: Rect = { x: 8, y: 31, width: 900, height: 670 }
  isDestroyed = (): boolean => false
  isMinimized = (): boolean => this.minimized
  getBounds = (): Rect => this.outer
  getContentBounds = (): Rect => this.content
}

beforeEach(() => {
  screen.listeners.clear()
  screen.getDisplayMatching.mockReturnValue({ workAreaSize: { width: 1920, height: 1040 } })
})

describe('window minimum size', () => {
  it('clamps the floor to a small work area and keeps it on a large one', () => {
    expect(minimumSizeFor({ width: 1093, height: 614 })).toEqual([900, 614])
    expect(minimumSizeFor({ width: 1920, height: 1040 })).toEqual([900, 670])
  })

  it('adds the frame back so the page itself keeps 900x670', () => {
    const frame = { width: 16, height: 39 }
    expect(minimumSizeFor({ width: 1920, height: 1040 }, frame)).toEqual([916, 709])
    expect(minimumSizeFor({ width: 1093, height: 614 }, frame)).toEqual([916, 614])
  })

  it('applies the outer-window floor at once, measured from the real frame', () => {
    // setMinimumSize takes the outer size even for a content-sized window, so
    // passing 900x670 here would let the page shrink to 884x631 again.
    const window = new FakeWindow()
    keepMinimumSizeOnScreen(window as never)
    expect(window.setMinimumSize).toHaveBeenLastCalledWith(916, 709)
  })

  it('re-clamps for the display the window moved to, and stops listening once closed', () => {
    const window = new FakeWindow()
    keepMinimumSizeOnScreen(window as never)
    screen.getDisplayMatching.mockReturnValue({ workAreaSize: { width: 1093, height: 614 } })

    window.emit('move')
    expect(window.setMinimumSize).toHaveBeenLastCalledWith(916, 614)

    window.emit('closed')
    expect(screen.listenerCount('display-metrics-changed')).toBe(0)
    expect(screen.listenerCount('display-removed')).toBe(0)
  })

  it('leaves the floor alone while minimized, when the bounds say nothing about the frame', () => {
    const window = new FakeWindow()
    keepMinimumSizeOnScreen(window as never)
    window.setMinimumSize.mockClear()
    window.minimized = true
    window.content = { x: 0, y: 0, width: 0, height: 0 }

    window.emit('move')
    expect(window.setMinimumSize).not.toHaveBeenCalled()
  })
})
