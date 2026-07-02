// @vitest-environment jsdom
/**
 * TopBar onlineCount derivation test (2026-07 audit W6).
 *
 * Pins the §8 status indicator: online = presence 'active' OR 'in-game',
 * summed across BOTH platforms, with the i18next _one/_other plural applied.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { Friend } from '@shared/types'
import i18n from '../i18n'
import TopBar from './TopBar'

const useFriendsMock = vi.hoisted(() => vi.fn())
vi.mock('../queries/friends', () => ({ useFriends: useFriendsMock }))

// jsdom has no ResizeObserver (the bubble-measuring effect observes the track).
class ResizeObserverStub {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)

function friend(state: Friend['presence']['state']): Friend {
  return { presence: { state } } as unknown as Friend
}

function stubFriends(vrc: Friend[], cvr: Friend[]): void {
  useFriendsMock.mockImplementation((platform: string) =>
    platform === 'vrchat' ? { data: vrc } : { data: cvr }
  )
}

afterEach(() => {
  cleanup()
  useFriendsMock.mockReset()
})

describe('TopBar onlineCount (W6)', () => {
  it('counts active + in-game across both platforms; offline excluded', () => {
    stubFriends(
      [friend('in-game'), friend('active'), friend('offline')],
      [friend('in-game'), friend('offline')]
    )
    render(<TopBar />)
    expect(screen.getByText(i18n.t('shell.onlineCount', { count: 3 }))).toBeTruthy()
  })

  it('uses the singular form for exactly one friend online', () => {
    stubFriends([friend('active')], [])
    render(<TopBar />)
    expect(screen.getByText(i18n.t('shell.onlineCount', { count: 1 }))).toBeTruthy()
  })

  it('renders zero (plural form) when queries have no data yet', () => {
    useFriendsMock.mockImplementation(() => ({ data: undefined }))
    render(<TopBar />)
    expect(screen.getByText(i18n.t('shell.onlineCount', { count: 0 }))).toBeTruthy()
  })
})
