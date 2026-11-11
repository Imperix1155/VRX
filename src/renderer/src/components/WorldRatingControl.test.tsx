// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExploreWorldSnapshot } from '@shared/explore'
import type { SetWorldRatingResult, WorldRatingRead } from '@shared/worldRating'
import '../i18n'
import { queryClient } from '../queries/queryClient'
import { worldRatingQueryKeyForPlatform } from '../queries/worldRating'
import ExploreWorldSheet from './ExploreWorldSheet'
import WorldRatingControl, { WORLD_RATING_ERROR_MS } from './WorldRatingControl'

let getWorldRating: ReturnType<typeof vi.fn<(req: unknown) => Promise<WorldRatingRead>>>
let setWorldRating: ReturnType<typeof vi.fn<(req: unknown) => Promise<SetWorldRatingResult>>>

function signIn(accountId: string | null): void {
  queryClient.setQueryData(
    ['auth-status', 'vrchat'],
    accountId === null
      ? { platform: 'vrchat', state: 'unauthenticated', accountId: null, displayName: null }
      : { platform: 'vrchat', state: 'authenticated', accountId, displayName: 'Me' }
  )
}

function sheet(platform: 'vrchat' | 'chilloutvr'): ExploreWorldSnapshot {
  const selected = {
    platform,
    worldId: platform === 'vrchat' ? 'wrld_4cf554b4-430c-4f8f-b53e-1f294eed230b' : 'cvr-world',
    worldRef: 'ref-a',
    name: 'Sunset Lounge',
    thumbnailUrl: null,
    activity: { state: 'complete' as const, value: 1, source: 'visible-rooms' as const },
    visibleRoomCount: { state: 'complete' as const, value: 0, source: 'visible-rooms' as const },
    popularity: null,
    sourceOrder: 0
  }
  return {
    platform,
    world: selected,
    rooms: [],
    roomsComplete: true,
    status: 'ready',
    problem: null,
    isStale: false,
    updatedAt: null
  }
}

beforeEach(() => {
  getWorldRating = vi.fn(async () => ({ ok: true, value: null }) as const)
  setWorldRating = vi.fn(async () => ({ ok: true, value: 'like' }) as const)
  window.vrx = { getWorldRating, setWorldRating } as unknown as Window['vrx']
  signIn('usr_me')
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  queryClient.removeQueries({ queryKey: ['auth-status'] })
  queryClient.removeQueries({ queryKey: worldRatingQueryKeyForPlatform('vrchat') })
})

async function readyLike(): Promise<HTMLButtonElement> {
  const button = await screen.findByRole<HTMLButtonElement>('button', {
    name: 'Like Sunset Lounge'
  })
  await waitFor(() => expect(button.disabled).toBe(false))
  return button
}

describe('WorldRatingControl', () => {
  it('stays off a ChilloutVR sheet and shows disabled choices when VRChat is signed out', () => {
    signIn(null)
    const { unmount } = render(
      <ExploreWorldSheet
        snapshot={sheet('chilloutvr')}
        opener={null}
        focusFallback={null}
        onClose={vi.fn()}
        onJoin={vi.fn()}
      />
    )
    expect(screen.queryByRole('group', { name: 'Your rating of this world' })).toBeNull()
    unmount()
    render(
      <ExploreWorldSheet
        snapshot={sheet('vrchat')}
        opener={null}
        focusFallback={null}
        onClose={vi.fn()}
        onJoin={vi.fn()}
      />
    )
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Like Sunset Lounge' }).disabled
    ).toBe(true)
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Dislike Sunset Lounge' }).disabled
    ).toBe(true)
    expect(screen.getByText('Sign in to VRChat to rate this world.')).toBeTruthy()
    expect(getWorldRating).not.toHaveBeenCalled()
  })

  it('reads the rating when the sheet is signed in and toggles like, dislike and clear', async () => {
    getWorldRating.mockResolvedValue({ ok: true, value: 'like' })
    render(<WorldRatingControl worldRef="ref-a" worldName="Sunset Lounge" />)
    const liked = await screen.findByRole<HTMLButtonElement>('button', {
      name: 'Liked. Clear your rating of Sunset Lounge'
    })
    await waitFor(() => expect(liked.disabled).toBe(false))
    expect(liked.getAttribute('aria-pressed')).toBe('true')
    expect(getWorldRating).toHaveBeenCalledTimes(1)
    expect(getWorldRating).toHaveBeenCalledWith({ platform: 'vrchat', worldRef: 'ref-a' })

    setWorldRating.mockResolvedValue({ ok: true, value: 'dislike' })
    fireEvent.click(screen.getByRole('button', { name: 'Dislike Sunset Lounge' }))
    expect(
      screen
        .getByRole('button', { name: 'Disliked. Clear your rating of Sunset Lounge' })
        .getAttribute('aria-pressed')
    ).toBe('true')
    await waitFor(() =>
      expect(setWorldRating).toHaveBeenCalledWith({
        platform: 'vrchat',
        worldRef: 'ref-a',
        value: 'dislike'
      })
    )

    setWorldRating.mockResolvedValue({ ok: true, value: null })
    fireEvent.click(
      screen.getByRole('button', { name: 'Disliked. Clear your rating of Sunset Lounge' })
    )
    await waitFor(() =>
      expect(setWorldRating).toHaveBeenLastCalledWith({
        platform: 'vrchat',
        worldRef: 'ref-a',
        value: null
      })
    )
    expect(
      screen.getByRole('button', { name: 'Dislike Sunset Lounge' }).getAttribute('aria-pressed')
    ).toBe('false')
  })

  it('disables both buttons while a press is in flight, then rolls back and clears the error', async () => {
    render(<WorldRatingControl worldRef="ref-a" worldName="Sunset Lounge" />)
    await readyLike()
    let finish: (result: SetWorldRatingResult) => void = () => undefined
    setWorldRating.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Like Sunset Lounge' }))
    expect(
      screen.getByRole<HTMLButtonElement>('button', {
        name: 'Liked. Clear your rating of Sunset Lounge'
      }).disabled
    ).toBe(true)
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Dislike Sunset Lounge' }).disabled
    ).toBe(true)
    expect(screen.getByText('Saving your rating…')).toBeTruthy()

    vi.useFakeTimers()
    await act(async () => {
      finish({ ok: false, reason: 'failed' })
      await Promise.resolve()
    })
    expect(
      screen.getByRole('button', { name: 'Like Sunset Lounge' }).getAttribute('aria-pressed')
    ).toBe('false')
    expect(screen.getByRole('alert').textContent).toBe("VRChat didn't save your rating. Try again.")
    act(() => {
      vi.advanceTimersByTime(WORLD_RATING_ERROR_MS)
    })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('does not ask again while the cached rating is still fresh', async () => {
    const { unmount } = render(<WorldRatingControl worldRef="ref-a" worldName="Sunset Lounge" />)
    await readyLike()
    expect(getWorldRating).toHaveBeenCalledTimes(1)
    unmount()
    render(<WorldRatingControl worldRef="ref-a" worldName="Sunset Lounge" />)
    await readyLike()
    expect(getWorldRating).toHaveBeenCalledTimes(1)
  })
})
