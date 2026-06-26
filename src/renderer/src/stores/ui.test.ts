import { beforeEach, describe, expect, it } from 'vitest'
import { useUiStore } from './ui'
import type { ActiveTab } from './ui'

describe('useUiStore', () => {
  beforeEach(() => {
    useUiStore.setState({ activeTab: 'dashboard', drawerOpen: false })
  })

  it('seeds with dashboard as the default active tab', () => {
    expect(useUiStore.getState().activeTab).toBe('dashboard')
  })

  it('setActiveTab switches between all §8 nav views', () => {
    const tabs: ActiveTab[] = [
      'dashboard',
      'activity',
      'friends',
      'instances',
      'groups',
      'settings'
    ]
    for (const tab of tabs) {
      useUiStore.getState().setActiveTab(tab)
      expect(useUiStore.getState().activeTab).toBe(tab)
    }
  })

  it('drawerOpen is false by default', () => {
    expect(useUiStore.getState().drawerOpen).toBe(false)
  })

  it('setDrawerOpen sets the drawer state directly', () => {
    useUiStore.getState().setDrawerOpen(true)
    expect(useUiStore.getState().drawerOpen).toBe(true)
    useUiStore.getState().setDrawerOpen(false)
    expect(useUiStore.getState().drawerOpen).toBe(false)
  })

  it('toggleDrawer flips the drawer state', () => {
    useUiStore.getState().toggleDrawer()
    expect(useUiStore.getState().drawerOpen).toBe(true)
    useUiStore.getState().toggleDrawer()
    expect(useUiStore.getState().drawerOpen).toBe(false)
  })
})
