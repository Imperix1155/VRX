// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useRef } from 'react'
import {
  AVATAR_MAX_RETRIES,
  AVATAR_RENDERER_CACHE_MAX_BYTES,
  AVATAR_RETRY_DELAY_MS,
  AvatarDataCache,
  useAvatar
} from './useAvatar'

type ObserverCallback = ConstructorParameters<typeof IntersectionObserver>[0]

const observers: IntersectionObserverStub[] = []

class IntersectionObserverStub implements IntersectionObserver {
  readonly root = null
  readonly rootMargin: string
  readonly scrollMargin = '0px'
  readonly thresholds = [0]
  readonly observe = vi.fn()
  readonly unobserve = vi.fn()
  readonly disconnect = vi.fn()
  readonly takeRecords = vi.fn(() => [])
  private readonly callback: ObserverCallback

  constructor(callback: ObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback
    this.rootMargin = options?.rootMargin ?? '0px'
    observers.push(this)
  }

  intersect(isIntersecting: boolean): void {
    this.callback([{ isIntersecting } as IntersectionObserverEntry], this)
  }
}

vi.stubGlobal('IntersectionObserver', IntersectionObserverStub)

function Harness({ url }: { url: string }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const dataUrl = useAvatar(url, ref)
  return (
    <div ref={ref} data-testid="target">
      {dataUrl ?? 'placeholder'}
    </div>
  )
}

afterEach(() => {
  cleanup()
  observers.length = 0
  vi.restoreAllMocks()
})

describe('useAvatar', () => {
  it('waits for near-visibility, then shares one bridge request per URL', async () => {
    const getAvatar = vi
      .fn()
      .mockResolvedValue({ ok: true, dataUrl: 'data:image/png;base64,YXZhdGFy' })
    window.vrx = { getAvatar } as unknown as Window['vrx']
    const url = 'https://files.vrchat.cloud/avatar/hook-test.png'

    const first = render(<Harness url={url} />)
    expect(getAvatar).not.toHaveBeenCalled()
    expect(observers[0]?.rootMargin).toBe('200px')

    observers[0]?.intersect(true)
    await waitFor(() => expect(screen.getByTestId('target').textContent).toContain('data:image'))
    expect(getAvatar).toHaveBeenCalledTimes(1)

    first.unmount()
    render(<Harness url={url} />)
    observers.at(-1)?.intersect(true)
    await waitFor(() => expect(screen.getByTestId('target').textContent).toContain('data:image'))
    expect(getAvatar).toHaveBeenCalledTimes(1)
  })

  it('keeps the placeholder when the preload bridge is absent', () => {
    Object.defineProperty(window, 'vrx', { configurable: true, value: undefined })
    render(<Harness url="https://files.abinteractive.net/avatar/no-bridge.png" />)

    observers[0]?.intersect(true)
    expect(screen.getByTestId('target').textContent).toBe('placeholder')
  })

  it('does not cache a null result, so a later mount retries successfully', async () => {
    const getAvatar = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ok: true, dataUrl: 'data:image/png;base64,cmV0cnk=' })
    window.vrx = { getAvatar } as unknown as Window['vrx']
    const url = 'https://files.vrchat.cloud/avatar/retry-after-null.png'

    const first = render(<Harness url={url} />)
    observers.at(-1)?.intersect(true)
    await waitFor(() => expect(getAvatar).toHaveBeenCalledTimes(1))
    first.unmount()

    render(<Harness url={url} />)
    observers.at(-1)?.intersect(true)
    await waitFor(() => expect(screen.getByTestId('target').textContent).toContain('data:image'))
    expect(getAvatar).toHaveBeenCalledTimes(2)
  })

  it('bounds successful renderer entries with least-recently-used eviction', async () => {
    const getAvatar = vi.fn(async (url: string) => ({
      ok: true as const,
      dataUrl: `data:image/png;base64,${url}`
    }))
    window.vrx = { getAvatar } as unknown as Window['vrx']
    const urls = Array.from(
      { length: 201 },
      (_, index) => `https://files.abinteractive.net/avatar/lru-${index}.png`
    )

    for (const url of urls) {
      const view = render(<Harness url={url} />)
      observers.at(-1)?.intersect(true)
      await waitFor(() => expect(screen.getByTestId('target').textContent).toContain('data:image'))
      view.unmount()
    }
    render(<Harness url={urls[0]!} />)
    observers.at(-1)?.intersect(true)
    await waitFor(() => expect(screen.getByTestId('target').textContent).toContain('data:image'))

    expect(getAvatar).toHaveBeenCalledTimes(urls.length + 1)
  })

  it('re-arms a visible avatar after a transient failure, a bounded number of times', async () => {
    vi.useFakeTimers()
    try {
      const getAvatar = vi.fn().mockResolvedValue(null)
      window.vrx = { getAvatar } as unknown as Window['vrx']
      const url = 'https://files.vrchat.cloud/avatar/retry-test.png'
      const view = render(<Harness url={url} />)
      const observer = observers[0]!

      for (let attempt = 0; attempt <= AVATAR_MAX_RETRIES; attempt++) {
        expect(observer.observe).toHaveBeenCalledTimes(attempt + 1)
        await act(async () => {
          observer.intersect(true)
          await Promise.resolve()
        })
        expect(getAvatar).toHaveBeenCalledTimes(attempt + 1)
        await act(async () => {
          vi.advanceTimersByTime(AVATAR_RETRY_DELAY_MS - 1)
        })
        expect(observer.observe).toHaveBeenCalledTimes(attempt + 1)
        await act(async () => {
          vi.advanceTimersByTime(1)
        })
      }
      // Budget exhausted: no further re-arm.
      expect(observer.observe).toHaveBeenCalledTimes(AVATAR_MAX_RETRIES + 1)

      // Recovery after a retry shows the image.
      getAvatar.mockResolvedValue({ ok: true, dataUrl: 'data:image/png;base64,b2s=' })
      view.unmount()
      render(<Harness url={url} />)
      await act(async () => {
        observers.at(-1)!.intersect(true)
        await Promise.resolve()
      })
      expect(screen.getByTestId('target').textContent).toContain('data:image')
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels a pending retry on unmount', async () => {
    vi.useFakeTimers()
    try {
      const getAvatar = vi.fn().mockResolvedValue(null)
      window.vrx = { getAvatar } as unknown as Window['vrx']
      const view = render(<Harness url="https://files.vrchat.cloud/avatar/unmount.png" />)
      const observer = observers[0]!
      await act(async () => {
        observer.intersect(true)
        await Promise.resolve()
      })
      view.unmount()
      vi.advanceTimersByTime(AVATAR_RETRY_DELAY_MS)
      expect(observer.observe).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('AvatarDataCache byte budget (issue 370)', () => {
  it('evicts least recently used entries by total size', () => {
    const cache = new AvatarDataCache(200, 10)
    cache.set('a', '1234')
    cache.set('b', '1234')
    expect(cache.get('a')).toBe('1234') // a is now most recent
    cache.set('c', '1234') // 12 > 10 → evict b
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('a')).toBe('1234')
    expect(cache.retainedBytes).toBe(8)
  })

  it('still honours the entry-count cap', () => {
    const cache = new AvatarDataCache(2, 1000)
    cache.set('a', 'x')
    cache.set('b', 'x')
    cache.set('c', 'x')
    expect(cache.size).toBe(2)
    expect(cache.get('a')).toBeUndefined()
  })

  it('does not retain a value larger than the whole budget, and replaces in place', () => {
    const cache = new AvatarDataCache(200, 4)
    cache.set('a', '12345')
    expect(cache.size).toBe(0)
    cache.set('a', '12')
    cache.set('a', '1234')
    expect(cache.retainedBytes).toBe(4)
    expect(cache.size).toBe(1)
  })

  it('defaults to a 48 MiB budget', () => {
    expect(AVATAR_RENDERER_CACHE_MAX_BYTES).toBe(48 * 1024 * 1024)
  })
})
