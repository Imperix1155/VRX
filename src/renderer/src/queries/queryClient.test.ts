import { describe, expect, it } from 'vitest'
import { queryClient } from './queryClient'

describe('queryClient retry policy', () => {
  it('does not retry rate_limited errors but preserves three retries for other failures', () => {
    const retry = queryClient.getDefaultOptions().queries?.retry

    expect(typeof retry).toBe('function')
    if (typeof retry !== 'function') return

    expect(retry(0, new Error('rate_limited'))).toBe(false)
    expect(retry(0, new Error('network failed'))).toBe(true)
    expect(retry(2, new Error('network failed'))).toBe(true)
    expect(retry(3, new Error('network failed'))).toBe(false)
  })
})
