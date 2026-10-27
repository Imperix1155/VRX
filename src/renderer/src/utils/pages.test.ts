import { describe, expect, it } from 'vitest'
import { isPageShown } from './pages'

describe('isPageShown', () => {
  const hidden = { showHotInstancesPage: false, showExplorePage: false, showInboxPage: false }

  it('hides only the optional pages', () => {
    expect(isPageShown('hot', hidden)).toBe(false)
    expect(isPageShown('explore', hidden)).toBe(false)
    expect(isPageShown('inbox', hidden)).toBe(false)
    for (const tab of ['dashboard', 'friends', 'settings'] as const) {
      expect(isPageShown(tab, hidden)).toBe(true)
    }
  })

  it('shows every page when every switch is on', () => {
    const shown = { showHotInstancesPage: true, showExplorePage: true, showInboxPage: true }
    for (const tab of ['dashboard', 'hot', 'friends', 'inbox', 'explore', 'settings'] as const) {
      expect(isPageShown(tab, shown)).toBe(true)
    }
  })
})
