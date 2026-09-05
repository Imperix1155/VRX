// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Friend, InstanceInfo } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/settings'
import '../i18n'
import { useSettingsStore } from '../stores/settings'
import LinkedDestinationChooser from './LinkedDestinationChooser'

const join = vi.hoisted(() => vi.fn())
const useJoinInstance = vi.hoisted(() => vi.fn())
vi.mock('../hooks/useJoinInstance', () => ({ useJoinInstance }))
vi.mock('./LinkedDialog', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}))

const instance: InstanceInfo = {
  worldId: 'world',
  instanceId: 'world:one',
  worldName: 'World One',
  thumbnailUrl: null,
  type: 'public',
  openness: 'public',
  isGroup: false,
  groupName: null,
  groupId: null,
  groupImageUrl: null,
  region: null,
  userCount: null
}

function friend(
  platform: Friend['platform'],
  id: string,
  name: string,
  current = instance
): Friend {
  return platform === 'vrchat'
    ? {
        platform,
        platformUserId: id,
        displayName: name,
        avatarUrl: null,
        presence: { state: 'in-game' },
        status: 'online',
        statusDescription: null,
        trustRank: null,
        instance: current,
        isFavorite: false,
        favoriteGroupIds: [],
        linkedPersonId: null
      }
    : {
        platform,
        platformUserId: id,
        displayName: name,
        avatarUrl: null,
        presence: { state: 'in-game' },
        status: null,
        statusDescription: null,
        trustRank: null,
        instance: current,
        isFavorite: false,
        favoriteGroupIds: [],
        linkedPersonId: null
      }
}

beforeEach(() => {
  useJoinInstance.mockReturnValue({ join, isJoining: false, pendingConfirm: null })
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS, dirty: false })
})
afterEach(() => {
  cleanup()
  join.mockReset()
  Reflect.deleteProperty(window, 'vrx')
})

describe('LinkedDestinationChooser', () => {
  it('renders zero or one reviewed choice without inventing an offline destination', () => {
    const unavailable: Friend = {
      ...friend('vrchat', 'offline', 'Offline'),
      presence: { state: 'offline' },
      instance: null
    }
    const view = render(<LinkedDestinationChooser accounts={[unavailable]} onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /Join on/i })).toBeNull()

    view.rerender(
      <LinkedDestinationChooser accounts={[friend('vrchat', 'vrc', 'VRC')]} onClose={vi.fn()} />
    )
    // Destinations are captured on open; parent remounts the chooser for a new open.
    view.unmount()
    render(
      <LinkedDestinationChooser accounts={[friend('vrchat', 'vrc', 'VRC')]} onClose={vi.fn()} />
    )
    expect(screen.getAllByRole('button', { name: /Join on/i })).toHaveLength(1)
  })

  it('shows only joinable reviewed destinations and joins the selected original friend', () => {
    const vrc = friend('vrchat', 'vrc', 'VRC')
    const cvr = friend('chilloutvr', 'cvr', 'CVR', {
      ...instance,
      worldId: 'cvr-world',
      instanceId: 'cvr:one',
      worldName: 'CVR World'
    })
    const onClose = vi.fn()
    join.mockImplementation(() => expect(onClose).toHaveBeenCalledOnce())
    render(<LinkedDestinationChooser accounts={[vrc, cvr]} onClose={onClose} />)
    expect(screen.getAllByRole('button', { name: /Join on/i })).toHaveLength(2)
    fireEvent.click(screen.getAllByRole('button', { name: /Join on/i })[1]!)
    expect(onClose).toHaveBeenCalledOnce()
    expect(join).toHaveBeenCalledWith(cvr)
  })

  it('joins a cloned reviewed friend even when the input object mutates after opening', () => {
    const vrc = friend('vrchat', 'vrc', 'Original')
    render(<LinkedDestinationChooser accounts={[vrc]} onClose={vi.fn()} />)
    vrc.displayName = 'Mutated outside React'
    fireEvent.click(screen.getByRole('button', { name: /Join on/i }))
    expect(join).toHaveBeenCalledWith(expect.objectContaining({ displayName: 'Original' }))
  })

  it('invalidates synchronously on an identity boundary before a stale click can join', () => {
    let boundary: (() => void) | undefined
    Object.assign(window, {
      vrx: {
        onIdentityBoundary: (callback: () => void) => {
          boundary = callback
          return () => {}
        }
      }
    } as unknown as Window)
    const onClose = vi.fn()
    render(
      <LinkedDestinationChooser accounts={[friend('vrchat', 'vrc', 'VRC')]} onClose={onClose} />
    )
    boundary?.()
    fireEvent.click(screen.getByRole('button', { name: /Join on/i }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(join).not.toHaveBeenCalled()
  })

  it('disables changed offline or hidden destinations', () => {
    const vrc = friend('vrchat', 'vrc', 'VRC')
    const cvr = friend('chilloutvr', 'cvr', 'CVR')
    const view = render(<LinkedDestinationChooser accounts={[vrc, cvr]} onClose={vi.fn()} />)
    view.rerender(
      <LinkedDestinationChooser
        accounts={[
          { ...vrc, status: 'dnd' } as Extract<Friend, { platform: 'vrchat' }>,
          {
            ...cvr,
            presence: { state: 'offline' },
            instance: null
          }
        ]}
        onClose={vi.fn()}
      />
    )
    expect(
      screen
        .getAllByRole<HTMLButtonElement>('button', { name: /Join on/i })
        .every((button) => button.disabled)
    ).toBe(true)
  })

  it('keeps the healthy reviewed destination available when the other account disappears', () => {
    const vrc = friend('vrchat', 'vrc', 'VRC')
    const cvr = friend('chilloutvr', 'cvr', 'CVR')
    const onClose = vi.fn()
    const view = render(<LinkedDestinationChooser accounts={[vrc, cvr]} onClose={onClose} />)
    view.rerender(<LinkedDestinationChooser accounts={[cvr]} onClose={onClose} />)
    const choices = screen.getAllByRole<HTMLButtonElement>('button', { name: /Join on/i })
    expect(choices[0]!.disabled).toBe(true)
    expect(choices[1]!.disabled).toBe(false)
    fireEvent.click(choices[1]!)
    expect(join).toHaveBeenCalledWith(cvr)
  })

  it('disables reviewed choices when joining is turned off in settings', () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, allowJoinInstances: false } })
    render(
      <LinkedDestinationChooser accounts={[friend('vrchat', 'vrc', 'VRC')]} onClose={vi.fn()} />
    )
    const choice = screen.getByRole<HTMLButtonElement>('button', { name: /Join on/i })
    expect(choice.disabled).toBe(true)
    fireEvent.click(choice)
    expect(join).not.toHaveBeenCalled()
  })

  it('does not launch a destination that moved after the chooser opened', () => {
    const vrc = friend('vrchat', 'vrc', 'VRC')
    const view = render(<LinkedDestinationChooser accounts={[vrc]} onClose={vi.fn()} />)
    view.rerender(
      <LinkedDestinationChooser
        accounts={[{ ...vrc, instance: { ...instance, instanceId: 'world:moved' } }]}
        onClose={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /Join on/i }))
    expect(join).not.toHaveBeenCalled()
  })

  it('disables all choices when joining is unavailable', () => {
    useJoinInstance.mockReturnValue({ join, isJoining: true, pendingConfirm: null })
    render(
      <LinkedDestinationChooser accounts={[friend('vrchat', 'vrc', 'VRC')]} onClose={vi.fn()} />
    )
    expect(screen.getByRole<HTMLButtonElement>('button', { name: /Join on/i }).disabled).toBe(true)
  })

  it('disables choices while an existing confirmation is pending', () => {
    useJoinInstance.mockReturnValue({ join, isJoining: false, pendingConfirm: {} })
    render(
      <LinkedDestinationChooser accounts={[friend('vrchat', 'vrc', 'VRC')]} onClose={vi.fn()} />
    )
    expect(screen.getByRole<HTMLButtonElement>('button', { name: /Join on/i }).disabled).toBe(true)
  })
})
