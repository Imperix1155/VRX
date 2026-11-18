// @vitest-environment jsdom
/**
 * Quick reorder (owner, 2026-11-15): the saved sidebar order with Settings
 * always last, the right-click menu and its switch, reorder mode in the
 * sidebar and on the Dashboard's reorder list, Reset order, and the Settings
 * panel that holds the switch.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { DEFAULT_SETTINGS, type Settings } from '@shared/settings'
import { DASHBOARD_SECTIONS, SIDEBAR_PAGES } from '@shared/types'
import '../i18n'
import { translate as t } from '../i18n/translate'
import { useSettingsStore } from '../stores/settings'
import { useUiStore } from '../stores/ui'
import DashboardReorderList from './DashboardReorderList'
import QuickReorderMenu from './QuickReorderMenu'
import Sidebar from './Sidebar'

vi.mock('../hooks/useUpdater', () => ({
  useUpdater: () => ({
    state: {
      state: 'idle',
      currentVersion: '0.14.0',
      availableVersion: null,
      progressPercent: 0,
      failure: null
    },
    check: vi.fn(),
    download: vi.fn(),
    install: vi.fn()
  })
}))

const settings = (): Settings => useSettingsStore.getState().settings

function withSettings(patch: Partial<Settings>): void {
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, ...patch } })
}

function nav(): HTMLElement {
  return screen.getByRole('navigation', { name: t('shell.nav.aria') })
}

function navLabels(): string[] {
  return within(nav())
    .getAllByRole('button')
    .map((button) => button.textContent ?? '')
}

const labels = (tabs: readonly string[]): string[] => tabs.map((tab) => t(`shell.nav.${tab}`))

function page(tab: string): HTMLElement {
  return within(nav()).getByRole('button', { name: t(`shell.nav.${tab}`) })
}

/** Right-click the nav and press the menu's one item. */
function pickFromMenu(): void {
  fireEvent.contextMenu(page('friends'), { clientX: 60, clientY: 120 })
  fireEvent.click(screen.getByRole('menuitem'))
}

afterEach(() => {
  cleanup()
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS })
  useUiStore.setState({ activeTab: 'dashboard', reorderMode: false })
})

describe('Sidebar order', () => {
  it('follows the saved order and always ends with Settings', () => {
    withSettings({
      sidebarOrder: [
        'avatars',
        'friends',
        'dashboard',
        'hot',
        'activity',
        'inbox',
        'explore',
        'search',
        'groups'
      ]
    })
    render(<Sidebar />)
    expect(navLabels()).toEqual(
      labels([
        'avatars',
        'friends',
        'dashboard',
        'hot',
        'activity',
        'inbox',
        'explore',
        'search',
        'groups',
        'settings'
      ])
    )
  })

  it('offers nothing to drag outside reorder mode', () => {
    render(<Sidebar />)
    expect(nav().querySelector('[data-reorder-item]')).toBeNull()
    expect(nav().querySelector('[data-reorder-grip]')).toBeNull()
    fireEvent.keyDown(page('friends'), { key: 'ArrowDown' })
    expect(settings().sidebarOrder).toEqual([...SIDEBAR_PAGES])
  })
})

describe('Right-click menu', () => {
  it('opens on a right-click, starts reorder mode, and says Done while it is on', () => {
    render(<Sidebar />)
    fireEvent.contextMenu(page('friends'), { clientX: 60, clientY: 120 })
    const item = screen.getByRole('menuitem', { name: t('reorder.start') })
    expect(document.activeElement).toBe(item)
    fireEvent.click(item)
    expect(useUiStore.getState().reorderMode).toBe(true)
    expect(screen.queryByRole('menu')).toBeNull()

    fireEvent.contextMenu(page('friends'), { clientX: 60, clientY: 120 })
    fireEvent.click(screen.getByRole('menuitem', { name: t('reorder.done') }))
    expect(useUiStore.getState().reorderMode).toBe(false)
  })

  it('folds on Esc without starting anything, and on a press outside', () => {
    render(<Sidebar />)
    fireEvent.contextMenu(page('friends'), { clientX: 60, clientY: 120 })
    fireEvent.keyDown(screen.getByRole('menuitem'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(useUiStore.getState().reorderMode).toBe(false)

    fireEvent.contextMenu(page('friends'), { clientX: 60, clientY: 120 })
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('does nothing while Quick reorder is off', () => {
    withSettings({ quickReorder: false })
    render(<Sidebar />)
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    page('friends').dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

describe('Sidebar reorder mode', () => {
  it('lets every page but Settings move, and ends on Done or Esc', () => {
    render(<Sidebar />)
    pickFromMenu()
    for (const tab of SIDEBAR_PAGES) {
      expect(page(tab).hasAttribute('data-reorder-item')).toBe(true)
      expect(page(tab).querySelector('[data-reorder-grip]')).not.toBeNull()
    }
    expect(page('settings').hasAttribute('data-reorder-item')).toBe(false)
    expect(page('settings').querySelector('[data-reorder-grip]')).toBeNull()
    expect(screen.getByText(t('reorder.sidebarHint'))).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: t('reorder.done') }))
    expect(useUiStore.getState().reorderMode).toBe(false)
    expect(nav().querySelector('[data-reorder-item]')).toBeNull()

    pickFromMenu()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(useUiStore.getState().reorderMode).toBe(false)
  })

  it('moves a page with the arrow keys, saves it, and says where it went', () => {
    render(<Sidebar />)
    pickFromMenu()
    page('friends').focus()
    fireEvent.keyDown(page('friends'), { key: 'ArrowDown' })
    expect(settings().sidebarOrder.slice(0, 3)).toEqual(['dashboard', 'hot', 'friends'])
    expect(navLabels().slice(0, 3)).toEqual(labels(['dashboard', 'hot', 'friends']))
    expect(document.activeElement).toBe(page('friends'))
    expect(
      screen.getByText(
        t('reorder.moved', {
          name: t('shell.nav.friends'),
          position: 3,
          count: SIDEBAR_PAGES.length
        })
      )
    ).toBeTruthy()
    // The last movable page cannot pass Settings.
    fireEvent.keyDown(page('avatars'), { key: 'ArrowDown' })
    expect(navLabels().at(-1)).toBe(t('shell.nav.settings'))
    expect(settings().sidebarOrder.at(-1)).toBe('avatars')
  })

  it('still opens a page on a plain click', () => {
    render(<Sidebar />)
    pickFromMenu()
    fireEvent.click(page('friends'))
    expect(useUiStore.getState().activeTab).toBe('friends')
  })

  it('keeps hidden pages in their own places in the saved order', () => {
    withSettings({ showHotInstancesPage: false, showInboxPage: false })
    render(<Sidebar />)
    pickFromMenu()
    // On screen: dashboard, friends, activity, explore, ... Move Activity up.
    fireEvent.keyDown(page('activity'), { key: 'ArrowUp' })
    expect(settings().sidebarOrder).toEqual([
      'dashboard',
      'activity',
      'hot',
      'friends',
      'inbox',
      'explore',
      'search',
      'groups',
      'avatars'
    ])
  })

  it('puts the sidebar and the Dashboard back with Reset order', () => {
    withSettings({
      sidebarOrder: ['friends', ...SIDEBAR_PAGES.filter((tab) => tab !== 'friends')],
      dashboardSections: ['hot', 'popular', 'invites', 'wearing-now'],
      dashboardSectionOrder: 'hot-first'
    })
    render(<Sidebar />)
    pickFromMenu()
    const reset = screen.getByRole('button', { name: t('reorder.reset') })
    expect(reset.getAttribute('aria-disabled')).toBeNull()
    fireEvent.click(reset)
    expect(settings().sidebarOrder).toEqual([...SIDEBAR_PAGES])
    expect(settings().dashboardSections).toEqual([...DASHBOARD_SECTIONS])
    expect(settings().dashboardSectionOrder).toBe('popular-first')
    expect(screen.getByText(t('reorder.resetDone'))).toBeTruthy()
    // Nothing left to reset: the button stays focusable but does nothing.
    expect(reset.getAttribute('aria-disabled')).toBe('true')
    expect(reset.hasAttribute('disabled')).toBe(false)
    // Reset keeps reorder mode on.
    expect(useUiStore.getState().reorderMode).toBe(true)
  })
})

describe('Dashboard reorder list', () => {
  const rows = (): string[] =>
    within(screen.getByRole('list'))
      .getAllByRole('button')
      .map((button) => button.textContent ?? '')

  it('lists every section in order, marking one that is switched off', () => {
    withSettings({ dashboardInvites: false })
    render(<DashboardReorderList />)
    expect(rows()).toEqual([
      t('settings.dashboard.quickLaunch.label'),
      t('settings.dashboard.wearingNow.label'),
      t('settings.dashboard.invites.label') + t('reorder.sectionOff'),
      t('settings.dashboard.popular.label'),
      t('settings.dashboard.hot.label')
    ])
  })

  it('moves a section with the arrow keys and keeps the older order setting in step', () => {
    render(<DashboardReorderList />)
    const hot = screen.getByRole('button', { name: t('settings.dashboard.hot.label') })
    fireEvent.keyDown(hot, { key: 'ArrowUp' })
    expect(settings().dashboardSections).toEqual([
      'quick-launch',
      'wearing-now',
      'invites',
      'hot',
      'popular'
    ])
    expect(settings().dashboardSectionOrder).toBe('hot-first')
    expect(
      screen.getByText(
        t('reorder.moved', { name: t('settings.dashboard.hot.label'), position: 4, count: 5 })
      )
    ).toBeTruthy()
  })

  it('ends reorder mode with Done', () => {
    useUiStore.setState({ reorderMode: true })
    render(<DashboardReorderList />)
    fireEvent.click(screen.getByRole('button', { name: t('reorder.done') }))
    expect(useUiStore.getState().reorderMode).toBe(false)
  })
})

describe('Settings quick reorder panel', () => {
  function open(): HTMLElement {
    render(<QuickReorderMenu />)
    const opener = screen.getByRole('button', { name: t('reorder.setting.open') })
    expect(opener.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(opener)
    expect(opener.getAttribute('aria-expanded')).toBe('true')
    return opener
  }

  it('turns the right-click menu off and on', () => {
    open()
    const group = screen.getByRole('radiogroup', { name: t('reorder.setting.label') })
    fireEvent.click(within(group).getByRole('radio', { checked: false }))
    expect(settings().quickReorder).toBe(false)
    fireEvent.click(within(group).getByRole('radio', { checked: false }))
    expect(settings().quickReorder).toBe(true)
  })

  it('starts reorder mode on the Dashboard, even with the switch off', () => {
    withSettings({ quickReorder: false })
    useUiStore.setState({ activeTab: 'settings' })
    const opener = open()
    fireEvent.click(screen.getByRole('button', { name: t('reorder.setting.start') }))
    expect(useUiStore.getState().reorderMode).toBe(true)
    expect(useUiStore.getState().activeTab).toBe('dashboard')
    expect(opener.getAttribute('aria-expanded')).toBe('false')
  })

  it('resets the order, and folds on Esc with focus back on its button', () => {
    withSettings({ sidebarOrder: ['friends', ...SIDEBAR_PAGES.filter((tab) => tab !== 'friends')] })
    const opener = open()
    fireEvent.click(screen.getByRole('button', { name: t('reorder.reset') }))
    expect(settings().sidebarOrder).toEqual([...SIDEBAR_PAGES])
    fireEvent.keyDown(screen.getByRole('button', { name: t('reorder.reset') }), { key: 'Escape' })
    expect(opener.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(opener)
  })
})
