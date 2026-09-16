import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { DEFAULT_SETTINGS } from '@shared/settings'
import type { BackgroundGlow } from '@shared/types'
import AppShell from '@renderer/components/AppShell'
import LoginScreen from '@renderer/components/LoginScreen'
import FriendDrawer from '@renderer/components/FriendDrawer'
import DashboardView from '@renderer/components/DashboardView'
import JoinConfirmDialog from '@renderer/components/JoinConfirmDialog'
import ErrorBoundary from '@renderer/components/ErrorBoundary'
import { queryClient } from '@renderer/queries/queryClient'
import { authStatusQueryKey } from '@renderer/queries/auth'
import { friendsQueryKey } from '@renderer/queries/friends'
import { exploreQueryKey } from '@renderer/queries/explore'
import { linkedProfilesKey } from '@renderer/queries/linkedProfiles'
import { useSettingsStore } from '@renderer/stores/settings'
import { useUiStore } from '@renderer/stores/ui'
import { useProfileSelection } from '@renderer/stores/profileSelection'
import { useApplyTheme } from '@renderer/hooks/useApplyTheme'
import { useApplyGlow } from '@renderer/hooks/useApplyGlow'
import { useJoinInstance } from '@renderer/hooks/useJoinInstance'
import { fixtureAuth } from './fixture-bridge'
import { friends, getPlatformSnapshot, linkedSnapshot } from './fixtures'
import CatalogScene from './catalog-scenes'

function DrawerScene({ platform }: { platform: 'vrchat' | 'chilloutvr' }): React.JSX.Element {
  const [open, setOpen] = useState(true)
  const friend = friends[platform][0] ?? null
  return (
    <main className="fixture-canvas" tabIndex={-1}>
      <div className="fixture-controls">
        <button type="button" onClick={() => setOpen(true)}>
          Open {platform === 'vrchat' ? 'VRChat' : 'ChilloutVR'} drawer
        </button>
      </div>
      <DashboardView />
      <FriendDrawer friend={open ? friend : null} onClose={() => setOpen(false)} />
      <JoinConfirmDialog />
    </main>
  )
}

function JoinScene(): React.JSX.Element {
  const { join } = useJoinInstance()
  useEffect(() => {
    const friend = friends.vrchat[0]
    if (friend) void join(friend)
  }, [join])
  return (
    <main className="fixture-canvas" tabIndex={-1}>
      <div className="fixture-controls">
        <button
          type="button"
          onClick={() => {
            const friend = friends.vrchat[0]
            if (friend) void join(friend)
          }}
        >
          Open real Join confirmation
        </button>
        <span>Confirm demonstrates a local denial. No game can launch.</span>
      </div>
      <DashboardView />
      <JoinConfirmDialog />
    </main>
  )
}

function Scene({ name, variant }: { name: string; variant: string }): React.JSX.Element {
  useApplyTheme()
  useApplyGlow()
  if (name === 'login')
    return (
      <LoginScreen initialTwoFactor={variant === 'totp' || variant === 'email' ? variant : null} />
    )
  if (name === 'drawer')
    return <DrawerScene platform={variant === 'chilloutvr' ? 'chilloutvr' : 'vrchat'} />
  if (name === 'join') return <JoinScene />
  if (['dashboard', 'friends', 'linked', 'settings', 'updater'].includes(name)) return <AppShell />
  return (
    <main className="fixture-canvas">
      <CatalogScene scene={name} variant={variant} />
    </main>
  )
}

export function mountScene(root: HTMLElement, params: URLSearchParams): void {
  const name = params.get('scene') ?? 'dashboard'
  const variant = params.get('variant') ?? 'ready'
  const glow: BackgroundGlow =
    params.get('glow') === 'muted' ? 'muted' : params.get('glow') === 'vivid' ? 'vivid' : 'standard'
  queryClient.clear()
  queryClient.setDefaultOptions({
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      staleTime: Infinity
    }
  })
  for (const platform of ['vrchat', 'chilloutvr'] as const) {
    queryClient.setQueryData(authStatusQueryKey(platform), fixtureAuth(platform))
    queryClient.setQueryData(friendsQueryKey(platform), friends[platform])
    queryClient.setQueryData(exploreQueryKey(platform), getPlatformSnapshot(platform))
  }
  queryClient.setQueryData(linkedProfilesKey, structuredClone(linkedSnapshot))
  useSettingsStore.getState().setSettings({
    ...DEFAULT_SETTINGS,
    theme: params.get('theme') === 'light' ? 'light' : 'dark',
    backgroundGlow: glow,
    reconcileInterval: 'manual',
    confirmJoin: true
  })
  useSettingsStore.getState().hydrate()
  useUiStore
    .getState()
    .setActiveTab(
      name === 'friends' || name === 'linked'
        ? 'friends'
        : name === 'settings'
          ? 'settings'
          : 'dashboard'
    )
  if (name === 'linked') {
    const person = linkedSnapshot.profiles[0]
    const member = person?.members[0]
    if (person && member)
      useProfileSelection.getState().select({
        kind: 'person',
        personId: person.id,
        anchor: { platform: member.platform, friendId: member.friendId }
      })
  }
  document.body.classList.add('fixture-document')
  createRoot(root).render(
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <Scene name={name} variant={variant} />
      </ErrorBoundary>
    </QueryClientProvider>
  )
}
