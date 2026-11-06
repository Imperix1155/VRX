import { describe, expect, it } from 'vitest'
import { isPageShown } from './pages'

describe('isPageShown', () => {
  const hidden = {
    showHotInstancesPage: false,
    showExplorePage: false,
    showActivityPage: false,
    showInboxPage: false,
    showSearchPage: false,
    showGroupsPage: false
  }

  it('hides only the optional pages', () => {
    expect(isPageShown('hot', hidden)).toBe(false)
    expect(isPageShown('explore', hidden)).toBe(false)
    expect(isPageShown('activity', hidden)).toBe(false)
    expect(isPageShown('inbox', hidden)).toBe(false)
    expect(isPageShown('search', hidden)).toBe(false)
    expect(isPageShown('groups', hidden)).toBe(false)
    for (const tab of ['dashboard', 'friends', 'settings'] as const) {
      expect(isPageShown(tab, hidden)).toBe(true)
    }
  })

  it('shows every page when every switch is on', () => {
    const shown = {
      showHotInstancesPage: true,
      showExplorePage: true,
      showActivityPage: true,
      showInboxPage: true,
      showSearchPage: true,
      showGroupsPage: true
    }
    for (const tab of [
      'dashboard',
      'hot',
      'friends',
      'activity',
      'inbox',
      'explore',
      'search',
      'groups',
      'avatars',
      'settings'
    ] as const) {
      expect(isPageShown(tab, shown)).toBe(true)
    }
  })

  it('reads each switch on its own', () => {
    const onlyActivity = {
      showHotInstancesPage: false,
      showExplorePage: false,
      showActivityPage: true,
      showInboxPage: false,
      showSearchPage: false,
      showGroupsPage: false
    }
    expect(isPageShown('activity', onlyActivity)).toBe(true)
    expect(isPageShown('hot', onlyActivity)).toBe(false)
    expect(isPageShown('inbox', onlyActivity)).toBe(false)
    expect(isPageShown('search', onlyActivity)).toBe(false)
    expect(isPageShown('groups', { ...onlyActivity, showGroupsPage: true })).toBe(true)
  })
})
