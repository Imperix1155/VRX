import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import '../i18n'
import PolicySpacePill from './PolicySpacePill'

describe('PolicySpacePill', () => {
  it.each([
    ['public', 'Public space', '--policy-public-text', '--policy-public'],
    ['private', 'Private space', '--policy-private-text', '--policy-private']
  ] as const)(
    'renders the %s context with the shared colored pill recipe',
    (space, label, text, base) => {
      const markup = renderToStaticMarkup(createElement(PolicySpacePill, { space }))
      const className = /class="([^"]+)"/.exec(markup)?.[1]

      expect(markup).toMatch(/^<span/)
      expect(markup).toContain('data-policy-space-pill=""')
      expect(markup).toContain(`data-policy-space="${space}"`)
      expect(markup).toContain(label)
      expect(markup).toContain('h-[28px]')
      expect(markup).toContain('rounded-[10px]')
      expect(className?.split(/\s+/)).toContain('border')
      expect(markup).toContain('px-[12px]')
      expect(markup).toContain('text-[12px]')
      expect(markup).toContain('font-semibold')
      expect(markup).toContain(`var(${text})`)
      expect(markup).toContain(`var(${base}) 13%`)
      expect(markup).toContain(`var(${base}) 36%`)
    }
  )

  it('renders an unknown context with the existing neutral treatment', () => {
    const markup = renderToStaticMarkup(createElement(PolicySpacePill, { space: 'unknown' }))

    expect(markup).toContain('data-policy-space="unknown"')
    expect(markup).toContain('Unknown')
    expect(markup).toContain('var(--text-dim)')
    expect(markup).not.toContain('var(--policy-public)')
    expect(markup).not.toContain('var(--policy-private)')
  })
})
