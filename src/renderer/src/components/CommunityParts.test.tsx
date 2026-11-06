// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CommunityTile } from './CommunityParts'

type ObserverCallback = ConstructorParameters<typeof IntersectionObserver>[0]

// Every observed element counts as on screen at once.
class VisibleObserver implements IntersectionObserver {
  readonly root = null
  readonly rootMargin = '0px'
  readonly scrollMargin = '0px'
  readonly thresholds = [0]
  readonly unobserve = vi.fn()
  readonly disconnect = vi.fn()
  readonly takeRecords = vi.fn(() => [])
  constructor(private readonly callback: ObserverCallback) {}
  observe(): void {
    queueMicrotask(() =>
      this.callback([{ isIntersecting: true } as IntersectionObserverEntry], this)
    )
  }
}

vi.stubGlobal('IntersectionObserver', VisibleObserver)

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('CommunityTile icon shape', () => {
  it('still shows the group banner when the icon download fails', async () => {
    const icon = 'https://files.vrchat.cloud/group/broken-icon.png'
    const bannerUrl = 'https://files.vrchat.cloud/group/banner.png'
    const getAvatar = vi.fn((url: string) =>
      Promise.resolve(url === icon ? null : { ok: true, dataUrl: 'data:image/png;base64,YmFubmVy' })
    )
    window.vrx = { getAvatar } as unknown as Window['vrx']

    const { container } = render(
      <CommunityTile
        platform="vrchat"
        title="Broken Icon"
        imageUrl={icon}
        bannerUrl={bannerUrl}
        shape="icon"
      />
    )
    await waitFor(() =>
      expect(
        container
          .querySelector('[data-community-tile-banner]')
          ?.getAttribute('data-community-tile-banner')
      ).toBe('image')
    )
    // The icon was asked for first; the banner only after it answered.
    expect(getAvatar.mock.calls.map(([url]) => url)).toEqual([icon, bannerUrl])
    expect(getAvatar).toHaveBeenLastCalledWith(bannerUrl, 'picture')
    // The first letter stands in for the missing icon.
    expect(
      container
        .querySelector('[data-community-tile-picture]')
        ?.getAttribute('data-community-tile-picture')
    ).toBe('initial')
  })
})
