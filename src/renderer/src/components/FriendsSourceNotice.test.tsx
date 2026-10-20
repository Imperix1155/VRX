// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import FriendsSourceNotice from './FriendsSourceNotice'

afterEach(cleanup)

describe('FriendsSourceNotice (issue 368)', () => {
  it('renders nothing without failures', () => {
    const { container } = render(<FriendsSourceNotice failures={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('names each failed platform and retries only that platform', () => {
    const retryCvr = vi.fn()
    const retryVrc = vi.fn()
    render(
      <FriendsSourceNotice
        failures={[
          { platform: 'vrchat', kind: 'stale', isFetching: false, retry: retryVrc },
          { platform: 'chilloutvr', kind: 'missing', isFetching: false, retry: retryCvr }
        ]}
      />
    )
    expect(screen.getByRole('status')).toBeTruthy()
    expect(
      screen.getByText('VRChat friends could not refresh. Showing the last loaded list.')
    ).toBeTruthy()
    expect(
      screen.getByText('ChilloutVR friends could not load. This list is missing them.')
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry ChilloutVR' }))
    expect(retryCvr).toHaveBeenCalledOnce()
    expect(retryVrc).not.toHaveBeenCalled()
  })

  it('disables and labels only the platform whose own fetch is in flight', () => {
    const busyRetry = vi.fn()
    render(
      <FriendsSourceNotice
        failures={[
          { platform: 'vrchat', kind: 'missing', isFetching: false, retry: vi.fn() },
          { platform: 'chilloutvr', kind: 'missing', isFetching: true, retry: busyRetry }
        ]}
      />
    )
    // aria-disabled, not disabled, so focus stays on Retry while it runs.
    const busy = screen.getByRole('button', { name: 'Retrying ChilloutVR…' })
    expect(busy.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(busy)
    expect(busyRetry).not.toHaveBeenCalled()
    const idle = screen.getByRole('button', { name: 'Retry VRChat' })
    expect(idle.getAttribute('aria-disabled')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Retrying VRChat…' })).toBeNull()
  })

  it('uses the error color only for a missing platform and dims a stale one', () => {
    render(
      <FriendsSourceNotice
        failures={[
          { platform: 'vrchat', kind: 'stale', isFetching: false, retry: vi.fn() },
          { platform: 'chilloutvr', kind: 'missing', isFetching: false, retry: vi.fn() }
        ]}
      />
    )
    const [stale, missing] = screen.getAllByRole('listitem')
    expect(stale?.className).toContain('text-[var(--text-dim)]')
    expect(stale?.className).not.toContain('text-[var(--error)]')
    expect(missing?.className).toContain('text-[var(--error)]')
  })

  it('keeps list semantics inside the live status region', () => {
    render(
      <FriendsSourceNotice
        failures={[{ platform: 'chilloutvr', kind: 'missing', isFetching: false, retry: vi.fn() }]}
      />
    )
    expect(screen.getByRole('status').querySelector('ul')).not.toBeNull()
    expect(screen.getByRole('list')).toBeTruthy()
  })
})
