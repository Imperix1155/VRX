// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearExplorePlatform } from '../queries/explore'
import { useExploreImage } from './useExploreImage'

let observe!: (entry: { isIntersecting: boolean }) => void
let getExploreImage: ReturnType<typeof vi.fn>

function Card({
  worldRef,
  platform = 'vrchat'
}: {
  worldRef: string
  platform?: 'vrchat' | 'chilloutvr'
}): React.JSX.Element {
  const { ref, image } = useExploreImage(platform, worldRef)
  return <div ref={ref} data-testid="card" data-image={image ?? ''} />
}

beforeEach(() => {
  getExploreImage = vi.fn().mockResolvedValue(null)
  window.vrx = { getExploreImage } as unknown as Window['vrx']
  class Observer {
    constructor(private readonly callback: (entries: Array<{ isIntersecting: boolean }>) => void) {
      observe = (entry) => this.callback([entry])
    }
    observe(): void {
      void 0
    }
    disconnect(): void {
      void 0
    }
  }
  vi.stubGlobal('IntersectionObserver', Observer)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  clearExplorePlatform('vrchat')
  clearExplorePlatform('chilloutvr')
})

describe('useExploreImage', () => {
  it('does no offscreen image work and does not retry a terminal image result', async () => {
    render(<Card worldRef="world-ref" />)
    expect(getExploreImage).not.toHaveBeenCalled()
    await act(async () => observe({ isIntersecting: true }))
    expect(getExploreImage).toHaveBeenCalledOnce()
    await act(async () => observe({ isIntersecting: true }))
    expect(getExploreImage).toHaveBeenCalledOnce()
  })

  it('requires a new visible observation after a boundary clears image state', async () => {
    const { rerender } = render(<Card worldRef="world-ref" />)
    await act(async () => observe({ isIntersecting: true }))
    expect(getExploreImage).toHaveBeenCalledOnce()
    act(() => clearExplorePlatform('vrchat'))
    rerender(<Card worldRef="world-ref" />)
    expect(getExploreImage).toHaveBeenCalledOnce()
    await act(async () => observe({ isIntersecting: true }))
    expect(getExploreImage).toHaveBeenCalledTimes(2)
  })

  it('does not reset a VRChat card image for an unrelated ChilloutVR boundary', async () => {
    getExploreImage.mockResolvedValue({ ok: true, dataUrl: 'data:image/png;base64,fixture' })
    const { getByTestId } = render(<Card worldRef="world-ref" />)
    await act(async () => observe({ isIntersecting: true }))
    expect(getByTestId('card').getAttribute('data-image')).toContain('data:image/png')
    act(() => clearExplorePlatform('chilloutvr'))
    expect(getByTestId('card').getAttribute('data-image')).toContain('data:image/png')
  })

  it('cancels a card recovery while offscreen and resumes only after its retained delay', async () => {
    vi.useFakeTimers()
    getExploreImage
      .mockResolvedValueOnce({ ok: false, reason: 'deferred', retryAfterMs: 2_000 })
      .mockResolvedValueOnce({ ok: true, dataUrl: 'data:image/png;base64,recovered' })
    const { getByTestId } = render(<Card worldRef="world-ref" />)
    await act(async () => observe({ isIntersecting: true }))
    expect(getExploreImage).toHaveBeenCalledOnce()

    await act(async () => observe({ isIntersecting: false }))
    await act(async () => vi.advanceTimersByTimeAsync(10_000))
    expect(getExploreImage).toHaveBeenCalledOnce()

    await act(async () => observe({ isIntersecting: true }))
    await act(async () => vi.advanceTimersByTimeAsync(1_999))
    expect(getExploreImage).toHaveBeenCalledOnce()
    await act(async () => vi.advanceTimersByTimeAsync(1))
    expect(getExploreImage).toHaveBeenCalledTimes(2)
    expect(getByTestId('card').getAttribute('data-image')).toContain('data:image/png')
  })
})
