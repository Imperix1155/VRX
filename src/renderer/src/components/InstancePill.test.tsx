import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import InstancePill from './InstancePill'

describe('InstancePill', () => {
  it('renders the unchanged span variant when no join handler is provided', () => {
    const markup = renderToStaticMarkup(
      createElement(InstancePill, { label: 'Public', tier: 'public' })
    )

    expect(markup).toMatch(/^<span/)
    expect(markup).toContain('rounded-[10px]')
    expect(markup).toContain('var(--op-public-text)')
  })

  it('renders a type=button variant with the same pill recipe when join is enabled', () => {
    const markup = renderToStaticMarkup(
      createElement(InstancePill, {
        label: 'Public',
        tier: 'public',
        onJoin: vi.fn(),
        'aria-label': 'Join Alex in The Great Pug'
      })
    )

    expect(markup).toMatch(/^<button/)
    expect(markup).toContain('type="button"')
    expect(markup).toContain('aria-label="Join Alex in The Great Pug"')
    expect(markup).toContain('rounded-[10px]')
    expect(markup).toContain('var(--op-public-text)')
    expect(markup).toContain('focus:ring-1')
  })
})
