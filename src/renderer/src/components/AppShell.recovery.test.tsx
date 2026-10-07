// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import AppShell from './AppShell'
import { useUiStore } from '../stores/ui'
import '../i18n'
vi.mock('./Sidebar', () => ({ default: () => null }))
vi.mock('./TopBar', () => ({ default: () => null }))
vi.mock('./JoinConfirmDialog', () => ({ default: () => null }))
vi.mock('./RecoveryNotices', () => ({ default: () => null }))
vi.mock('../hooks/useExploreCoordinator', () => ({ useExploreCoordinator: () => undefined }))
vi.mock('./DashboardView', () => ({
  default: () => {
    throw new Error('broken panel')
  }
}))
vi.mock('./FriendsList', () => ({ default: () => <p>Healthy friends</p> }))
afterEach(() => {
  cleanup()
  useUiStore.setState({ activeTab: 'dashboard' })
})
it('lets another healthy tab recover while a repeated fault still reaches its boundary', () => {
  render(<AppShell />, { onCaughtError: () => undefined })
  expect(screen.getByRole('alert')).toBeTruthy()
  act(() => useUiStore.getState().setActiveTab('friends'))
  expect(screen.getByText('Healthy friends')).toBeTruthy()
  act(() => useUiStore.getState().setActiveTab('dashboard'))
  expect(screen.getByRole('alert')).toBeTruthy()
})
