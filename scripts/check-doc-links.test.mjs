import { describe, expect, it } from 'vitest'
import { anchorsOf, findBrokenLinks, headingSlug, linkTargets } from './check-doc-links.mjs'

describe('check-doc-links', () => {
  it('builds GitHub-style heading anchors', () => {
    expect(headingSlug('1. Renderer bridge: `window.vrx`')).toBe('1-renderer-bridge-windowvrx')
    expect(headingSlug('Request admission and queue')).toBe('request-admission-and-queue')
    expect([...anchorsOf('# Setup\n\n## Setup\n\n```\n# not a heading\n```\n')]).toEqual([
      'setup',
      'setup-1'
    ])
  })

  it('ignores links inside code spans and fences', () => {
    const markdown = 'See [a](a.md) and `[b](b.md)`.\n\n```\n[c](c.md)\n```\n[d](d.md#x "title")'
    expect(linkTargets(markdown)).toEqual(['a.md', 'd.md#x'])
  })

  it('finds no broken relative links in the committed docs', () => {
    expect(findBrokenLinks()).toEqual([])
  })
})
