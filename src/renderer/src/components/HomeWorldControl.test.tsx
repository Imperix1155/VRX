// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SetHomeWorldResult } from '@shared/homeWorld'
import '../i18n'
import { queryClient } from '../queries/queryClient'
import { homeWorldQueryKeyForPlatform } from '../queries/homeWorld'
import HomeWorldControl from './HomeWorldControl'

const WORLD = 'wrld_4cf554b4-430c-4f8f-b53e-1f294eed230b'
const OTHER = 'wrld_00000000-0000-4000-8000-000000000002'

let setHomeWorld: ReturnType<typeof vi.fn<(req: unknown) => Promise<SetHomeWorldResult>>>

function signIn(accountId: string | null): void {
  queryClient.setQueryData(
    ['auth-status', 'vrchat'],
    accountId === null
      ? { platform: 'vrchat', state: 'unauthenticated', accountId: null, displayName: null }
      : { platform: 'vrchat', state: 'authenticated', accountId, displayName: 'Me' }
  )
}

function control(worldId = WORLD, worldRef = 'ref-a'): React.JSX.Element {
  return (
    <HomeWorldControl
      platform="vrchat"
      worldRef={worldRef}
      worldId={worldId}
      worldName="Sunset Lounge"
      leading={<span>VRChat</span>}
    />
  )
}

beforeEach(() => {
  setHomeWorld = vi.fn(async () => ({ ok: true, platform: 'vrchat', worldId: WORLD }) as const)
  window.vrx = { setHomeWorld } as unknown as Window['vrx']
  signIn('usr_me')
})

afterEach(() => {
  cleanup()
  queryClient.removeQueries({ queryKey: ['auth-status'] })
  queryClient.removeQueries({ queryKey: homeWorldQueryKeyForPlatform('vrchat') })
})

describe('HomeWorldControl', () => {
  it('asks once, then sends one write by reference and says it is home', async () => {
    render(control())
    fireEvent.click(
      screen.getByRole('button', { name: 'Set Sunset Lounge as your VRChat home world' })
    )
    expect(setHomeWorld).not.toHaveBeenCalled()
    expect(
      screen.getByText('Make this your VRChat home world? It replaces the one you have now.')
    ).toBeTruthy()
    const confirm = screen.getByRole('button', { name: 'Make home' })
    expect(document.activeElement).toBe(confirm)

    await act(async () => {
      fireEvent.click(confirm)
      await Promise.resolve()
    })
    expect(setHomeWorld).toHaveBeenCalledTimes(1)
    expect(setHomeWorld).toHaveBeenCalledWith({ platform: 'vrchat', worldRef: 'ref-a' })
    expect(screen.getByLabelText('Sunset Lounge is your VRChat home world')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe(
      'Done. VRChat will start you here next time.'
    )
    expect(screen.queryByRole('button', { name: /home world/ })).toBeNull()
  })

  it('Cancel sends nothing and returns focus to the button', async () => {
    render(control())
    fireEvent.click(
      screen.getByRole('button', { name: 'Set Sunset Lounge as your VRChat home world' })
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      await Promise.resolve()
    })
    expect(setHomeWorld).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Set Sunset Lounge as your VRChat home world' })
    )
  })

  it('shows a failure in words and offers the button again', async () => {
    setHomeWorld.mockResolvedValueOnce({ ok: false, reason: 'cooldown' })
    render(control())
    fireEvent.click(
      screen.getByRole('button', { name: 'Set Sunset Lounge as your VRChat home world' })
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Make home' }))
      await Promise.resolve()
    })
    expect(screen.getByRole('status').textContent).toBe(
      'Wait a few seconds before changing your home world again.'
    )
    expect(
      screen.getByRole('button', { name: 'Set Sunset Lounge as your VRChat home world' })
    ).toBeTruthy()
  })

  it('remembers the home per account, and another world still offers the button', async () => {
    render(control())
    fireEvent.click(
      screen.getByRole('button', { name: 'Set Sunset Lounge as your VRChat home world' })
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Make home' }))
      await Promise.resolve()
    })
    cleanup()

    render(control())
    expect(screen.getByLabelText('Sunset Lounge is your VRChat home world')).toBeTruthy()
    cleanup()

    render(control(OTHER, 'ref-b'))
    expect(
      screen.getByRole('button', { name: 'Set Sunset Lounge as your VRChat home world' })
    ).toBeTruthy()
    cleanup()

    act(() => signIn('usr_someone_else'))
    render(control())
    expect(screen.queryByLabelText('Sunset Lounge is your VRChat home world')).toBeNull()
  })

  it('shows nothing extra when the platform is signed out', () => {
    signIn(null)
    render(control())
    expect(screen.getByText('VRChat')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })
})
