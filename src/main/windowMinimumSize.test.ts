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

class FakeWindow extends EventEmitter {
  setMinimumSize = vi.fn()
  isDestroyed = (): boolean => false
  getBounds = (): { x: number; y: number; width: number; height: number } => ({
    x: 0,
    y: 0,
    width: 900,
    height: 670
  })
}

beforeEach(() => {
  screen.listeners.clear()
})

describe('window minimum size', () => {
  it('clamps the floor to a small work area and keeps it on a large one', () => {
    expect(minimumSizeFor({ width: 1093, height: 614 })).toEqual([900, 614])
    expect(minimumSizeFor({ width: 1920, height: 1040 })).toEqual([900, 670])
  })

  it('re-clamps for the display the window moved to, and stops listening once closed', () => {
    const window = new FakeWindow()
    keepMinimumSizeOnScreen(window as never)
    screen.getDisplayMatching.mockReturnValue({ workAreaSize: { width: 1093, height: 614 } })

    window.emit('move')
    expect(window.setMinimumSize).toHaveBeenLastCalledWith(900, 614)

    window.emit('closed')
    expect(screen.listenerCount('display-metrics-changed')).toBe(0)
    expect(screen.listenerCount('display-removed')).toBe(0)
  })
})
