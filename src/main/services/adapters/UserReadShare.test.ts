import { describe, expect, it, vi } from 'vitest'
import { USER_READ_SHARE_MS, UserReadShare } from './UserReadShare'

describe('UserReadShare', () => {
  it('never hands one session an answer read for another', async () => {
    const share = new UserReadShare(() => 0)
    const load = vi.fn(async () => ({ id: 'a' }))
    await share.shared(1, 'a', load)
    await share.shared(2, 'a', load)
    expect(load).toHaveBeenCalledTimes(2)
    share.clear()
    await share.shared(2, 'a', load)
    expect(load).toHaveBeenCalledTimes(3)
  })

  it('times the window from when the answer arrived, not when it was asked for', async () => {
    let now = 0
    const share = new UserReadShare(() => now)
    let answer!: (value: unknown) => void
    const load = vi
      .fn<() => Promise<unknown>>()
      .mockReturnValueOnce(new Promise((resolve) => (answer = resolve)))
      .mockResolvedValue({ id: 'a' })
    const first = share.shared(1, 'a', load)
    now = USER_READ_SHARE_MS * 2
    expect(share.shared(1, 'a', load)).toBe(first)
    answer({ id: 'a' })
    await first
    now += USER_READ_SHARE_MS - 1
    expect(share.shared(1, 'a', load)).toBe(first)
    expect(load).toHaveBeenCalledOnce()
  })

  it('keeps answers for a bounded number of people', async () => {
    const share = new UserReadShare(() => 0)
    const load = vi.fn(async () => ({}))
    for (let i = 0; i <= 50; i++) await share.shared(1, `person-${i}`, load)
    await share.shared(1, 'person-50', load)
    expect(load).toHaveBeenCalledTimes(51)
    await share.shared(1, 'person-0', load)
    expect(load).toHaveBeenCalledTimes(52)
  })
})
