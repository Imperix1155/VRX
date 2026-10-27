import { describe, expect, it } from 'vitest'
import { isPageShown } from './pages'

describe('isPageShown', () => {
  const hidden = { showHotInstancesPage: false, showExplorePage: false, showActivityPage: false }

  it('hides only the optional pages', () => {
    expect(isPageShown('hot', hidden)).toBe(false)
    expect(isPageShown('explore', hidden)).toBe(false)
    expect(isPageShown('activity', hidden)).toBe(false)
    for (const tab of ['dashboard', 'friends', 'settings'] as const) {
      expect(isPageShown(tab, hidden)).toBe(true)
    }
  })

  it('shows every page when every switch is on', () => {
    const shown = { showHotInstancesPage: true, showExplorePage: true, showActivityPage: true }
    for (const tab of ['dashboard', 'hot', 'friends', 'activity', 'explore', 'settings'] as const) {
      expect(isPageShown(tab, shown)).toBe(true)
    }
  })

  it('reads each switch on its own', () => {
    const onlyActivity = {
      showHotInstancesPage: false,
      showExplorePage: false,
      showActivityPage: true
    }
    expect(isPageShown('activity', onlyActivity)).toBe(true)
    expect(isPageShown('hot', onlyActivity)).toBe(false)
  })
})
