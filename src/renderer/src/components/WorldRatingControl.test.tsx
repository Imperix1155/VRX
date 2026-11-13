// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExploreWorldSnapshot } from '@shared/explore'
import type { SetWorldRatingResult, WorldRatingRead } from '@shared/worldRating'
import '../i18n'
import { queryClient } from '../queries/queryClient'
import { WORLD_RATING_KEEP_MS, worldRatingQueryKeyForPlatform } from '../queries/worldRating'
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

  it('keeps a pending choice when the sheet is closed and opened again', async () => {
    const { unmount } = render(<WorldRatingControl worldRef="ref-a" worldName="Sunset Lounge" />)
    await readyLike()
    let finish: (result: SetWorldRatingResult) => void = () => undefined
    setWorldRating.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Like Sunset Lounge' }))
    unmount()
    render(<WorldRatingControl worldRef="ref-a" worldName="Sunset Lounge" />)

    const pending = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Liked. Clear your rating of Sunset Lounge'
    })
    expect(pending.disabled).toBe(true)
    expect(screen.getByText('Saving your rating…')).toBeTruthy()
    expect(setWorldRating).toHaveBeenCalledTimes(1)

    await act(async () => {
      finish({ ok: true, value: 'like' })
      await Promise.resolve()
    })
    await waitFor(() => expect(pending.disabled).toBe(false))

    setWorldRating.mockResolvedValue({ ok: true, value: null })
    fireEvent.click(pending)
    await waitFor(() =>
      expect(setWorldRating).toHaveBeenLastCalledWith({
        platform: 'vrchat',
        worldRef: 'ref-a',
        value: null
      })
    )
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

  it('keeps the rating it shows for as long as the sheet stays open', async () => {
    vi.useFakeTimers()
    getWorldRating.mockResolvedValue({ ok: true, value: 'like' })
    const { unmount } = render(<WorldRatingControl worldRef="ref-a" worldName="Sunset Lounge" />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    const liked = { name: 'Liked. Clear your rating of Sunset Lounge' }
    expect(screen.getByRole<HTMLButtonElement>('button', liked).disabled).toBe(false)

    // Long past the time an unused rating is kept for.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WORLD_RATING_KEEP_MS * 3)
    })
    expect(screen.getByRole<HTMLButtonElement>('button', liked).disabled).toBe(false)
    expect(screen.queryByText('Loading your rating…')).toBeNull()
    expect(getWorldRating).toHaveBeenCalledTimes(1)

    // Once no sheet shows it, the rating is let go after that time.
    unmount()
    const key = ['world-rating', 'vrchat', 'usr_me', 'ref-a']
    expect(queryClient.getQueryData(key)).toBe('like')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WORLD_RATING_KEEP_MS + 1)
    })
    expect(queryClient.getQueryData(key)).toBeUndefined()
  })

  it('never sits at Loading with no read out: a rating that goes missing offers Try again', async () => {
    getWorldRating.mockResolvedValue({ ok: true, value: 'like' })
    render(<WorldRatingControl worldRef="ref-a" worldName="Sunset Lounge" />)
    const liked = { name: 'Liked. Clear your rating of Sunset Lounge' }
    await screen.findByRole('button', liked)

    // The rating is dropped under the open sheet and nothing is on its way.
    act(() => {
      queryClient.removeQueries({ queryKey: worldRatingQueryKeyForPlatform('vrchat') })
    })
    expect(screen.queryByText('Loading your rating…')).toBeNull()
    expect(screen.getByRole('alert').textContent).toBe("Couldn't load your rating.")
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Like Sunset Lounge' }).disabled
    ).toBe(true)
    expect(getWorldRating).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>('button', liked).disabled).toBe(false)
    )
    expect(screen.queryByRole('alert')).toBeNull()
    expect(getWorldRating).toHaveBeenCalledTimes(2)
  })

  it('ends a failed read with a line and Try again, and one press reads once more', async () => {
    getWorldRating.mockResolvedValueOnce({ ok: false, reason: 'failed' })
    render(<WorldRatingControl worldRef="ref-a" worldName="Sunset Lounge" />)

    // The read is over: no "Loading" line, a line about reading (not saving).
    expect((await screen.findByRole('alert')).textContent).toBe("Couldn't load your rating.")
    expect(screen.queryByText('Loading your rating…')).toBeNull()
    const like = screen.getByRole<HTMLButtonElement>('button', { name: 'Like Sunset Lounge' })
    expect(like.disabled).toBe(true)
    // Nothing is retried on its own.
    expect(getWorldRating).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    // The button is leaving; focus goes to the choices, not to the page.
    expect(document.activeElement).toBe(
      screen.getByRole('group', { name: 'Your rating of this world' })
    )
    await waitFor(() => expect(like.disabled).toBe(false))
    expect(getWorldRating).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('shows the loading line during Try again, and comes back the same when it fails again', async () => {
    let answer: (result: WorldRatingRead) => void = () => undefined
    getWorldRating
      .mockResolvedValueOnce({ ok: false, reason: 'failed' })
      .mockImplementationOnce(() => new Promise<WorldRatingRead>((resolve) => (answer = resolve)))
    render(<WorldRatingControl worldRef="ref-a" worldName="Sunset Lounge" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))

    // While the second read is out: the loading line, no error, no button.
    expect(screen.getByRole('status').textContent).toBe('Loading your rating…')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()

    await act(async () => answer({ ok: false, reason: 'failed' }))
    expect((await screen.findByRole('alert')).textContent).toBe("Couldn't load your rating.")
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
    expect(getWorldRating).toHaveBeenCalledTimes(2)
  })

  it('ends the read when the request was dropped or the bridge call throws', async () => {
    getWorldRating.mockResolvedValueOnce({ ok: false, reason: 'stale' })
    const first = render(<WorldRatingControl worldRef="ref-a" worldName="Sunset Lounge" />)
    expect((await screen.findByRole('alert')).textContent).toBe("Couldn't load your rating.")
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
    first.unmount()

    getWorldRating.mockRejectedValueOnce(new Error('boom'))
    render(<WorldRatingControl worldRef="ref-a" worldName="Sunset Lounge" />)
    expect((await screen.findByRole('alert')).textContent).toBe("Couldn't load your rating.")
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })

  it('offers no Try again when reading again cannot help, and forgets a failure on another world', async () => {
    getWorldRating.mockResolvedValueOnce({ ok: false, reason: 'unknown-world' })
    const view = render(<WorldRatingControl worldRef="ref-a" worldName="Sunset Lounge" />)
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Refresh this world, then try again.'
    )
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()

    view.rerender(<WorldRatingControl worldRef="ref-b" worldName="Quiet Library" />)
    const like = await screen.findByRole<HTMLButtonElement>('button', {
      name: 'Like Quiet Library'
    })
    await waitFor(() => expect(like.disabled).toBe(false))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it("keeps the platform's own reason on a failed read and offers no Try again when signed out", async () => {
    getWorldRating.mockResolvedValueOnce({ ok: false, reason: 'rate-limited' })
    render(<WorldRatingControl worldRef="ref-a" worldName="Sunset Lounge" />)
    expect((await screen.findByRole('alert')).textContent).toBe(
      'VRChat asked VRX to slow down. Try again in a minute.'
    )
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()

    act(() => signIn(null))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull())
    expect(screen.getByText('Sign in to VRChat to rate this world.')).toBeTruthy()
  })
})
