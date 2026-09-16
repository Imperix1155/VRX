import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import '@renderer/i18n'
import ExploreDashboardPreview from '@renderer/components/ExploreDashboardPreview'
import { LABEL_KEYS_BY_SCHEME } from '@renderer/utils/instanceTypeLabels'
import { getPlatformSnapshot, instanceExamples, worlds } from './fixtures'

describe('guide examples follow the production state contract', () => {
  it.each(['vrchat', 'chilloutvr'] as const)(
    'shows %s first load beside the other platform cards',
    (platform) => {
      const other = platform === 'vrchat' ? 'chilloutvr' : 'vrchat'
      const html = renderToStaticMarkup(
        createElement(ExploreDashboardPreview, {
          worlds: worlds[other].slice(0, 2),
          platformSnapshots: [getPlatformSnapshot(platform, 'loading'), getPlatformSnapshot(other)],
          onOpenWorld: () => undefined
        })
      )
      expect(html).toContain('worlds are loading')
      expect(html).toContain('People')
      expect(html).not.toContain('Visible rooms')
    }
  )

  it('covers every canonical instance label across the two platform models', () => {
    const examples = new Set(instanceExamples.map(({ instance }) => instance.type))
    expect([...examples].sort()).toEqual(Object.keys(LABEL_KEYS_BY_SCHEME.vrchat).sort())
    expect(instanceExamples.filter(({ platform }) => platform === 'vrchat')).toHaveLength(8)
    expect(instanceExamples.filter(({ platform }) => platform === 'chilloutvr')).toHaveLength(9)
  })
})
