// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import FriendsSourceNotice from './FriendsSourceNotice'

afterEach(cleanup)

describe('FriendsSourceNotice (issue 368)', () => {
  it('renders nothing without failures', () => {
    const { container } = render(<FriendsSourceNotice failures={[]} isFetching={false} />)
    expect(container.firstChild).toBeNull()
  })

  it('names each failed platform and retries only that platform', () => {
    const retryCvr = vi.fn()
    const retryVrc = vi.fn()
    render(
      <FriendsSourceNotice
        isFetching={false}
        failures={[
          { platform: 'vrchat', kind: 'stale', retry: retryVrc },
          { platform: 'chilloutvr', kind: 'missing', retry: retryCvr }
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

  it('disables retry while a fetch is in flight', () => {
    render(
      <FriendsSourceNotice
        isFetching
        failures={[{ platform: 'chilloutvr', kind: 'missing', retry: vi.fn() }]}
      />
    )
    const button = screen.getByRole('button', { name: 'Retrying ChilloutVR…' })
    expect((button as HTMLButtonElement).disabled).toBe(true)
  })
})
