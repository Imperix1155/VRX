import { describe, expect, it } from 'vitest'
import { parseWorldRatingBody } from './parseWorldRating'

describe('parseWorldRatingBody', () => {
  it('reads the signed-in user’s like, dislike or lack of a rating', () => {
    expect(parseWorldRatingBody({ value: 'like' })).toEqual({ ok: true, value: 'like' })
    expect(parseWorldRatingBody({ value: 'dislike' })).toEqual({ ok: true, value: 'dislike' })
    expect(parseWorldRatingBody({ value: null })).toEqual({ ok: true, value: null })
  })

  it('ignores extra fields and refuses a value the spec does not name', () => {
    expect(parseWorldRatingBody({ value: 'like', count: 12 })).toEqual({ ok: true, value: 'like' })
    for (const body of [
      null,
      undefined,
      'like',
      ['like'],
      {},
      { rating: 'like' },
      { value: 'LIKE' },
      { value: '' },
      { value: 1 },
      { value: { value: 'like' } }
    ]) {
      expect(parseWorldRatingBody(body)).toEqual({ ok: false })
    }
  })
})
