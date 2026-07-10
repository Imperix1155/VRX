// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useRef } from 'react'
import { useAvatar } from './useAvatar'

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
    observers[observers.length - 1]?.intersect(true)
    await waitFor(() => expect(screen.getByTestId('target').textContent).toContain('data:image'))
    expect(getAvatar).toHaveBeenCalledTimes(1)
  })

  it('keeps the placeholder when the preload bridge is absent', () => {
    Object.defineProperty(window, 'vrx', { configurable: true, value: undefined })
    render(<Harness url="https://files.abinteractive.net/avatar/no-bridge.png" />)

    observers[0]?.intersect(true)
    expect(screen.getByTestId('target').textContent).toBe('placeholder')
  })
})
