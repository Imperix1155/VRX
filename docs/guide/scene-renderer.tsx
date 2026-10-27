import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { DEFAULT_SETTINGS } from '@shared/settings'
import type { BackgroundGlow } from '@shared/types'
import AppShell from '@renderer/components/AppShell'
import LoginScreen from '@renderer/components/LoginScreen'
import SetupWizard from '@renderer/components/setup/SetupWizard'
import FriendDrawer from '@renderer/components/FriendDrawer'
import DashboardView from '@renderer/components/DashboardView'
import JoinConfirmDialog from '@renderer/components/JoinConfirmDialog'
import ErrorBoundary from '@renderer/components/ErrorBoundary'
import AppBackdrop from '@renderer/components/AppBackdrop'
import { appBackgroundKey } from '@renderer/queries/appBackground'
import { queryClient } from '@renderer/queries/queryClient'
import { authStatusQueryKey } from '@renderer/queries/auth'
import { friendsQueryKey } from '@renderer/queries/friends'
import { exploreQueryKey } from '@renderer/queries/explore'
import { linkedProfilesKey } from '@renderer/queries/linkedProfiles'
import { activityKey } from '@renderer/queries/activity'
import { useSettingsStore } from '@renderer/stores/settings'
import { useUiStore } from '@renderer/stores/ui'
import { useApplyTheme } from '@renderer/hooks/useApplyTheme'
import { useApplyGlow } from '@renderer/hooks/useApplyGlow'
import { useJoinInstance } from '@renderer/hooks/useJoinInstance'
import { fixtureAuth } from './fixture-bridge'
import {
  activityEntries,
  backgroundPicture,
  friends,
  getPlatformSnapshot,
  linkedSnapshot
} from './fixtures'
import CatalogScene from './catalog-scenes'
import { alertScopeFor, friendsFailureFor } from './scenarios'

function DrawerScene({
  platform,
  variant
}: {
  platform: 'vrchat' | 'chilloutvr'
  variant: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const openerRef = useRef<HTMLButtonElement>(null)
  const friend = friends[platform][0] ?? null
  return (
    <main className="fixture-canvas" tabIndex={-1}>
      <div className="fixture-controls">
        <button ref={openerRef} type="button" onClick={() => setOpen(true)}>
          Open {platform === 'vrchat' ? 'VRChat' : 'ChilloutVR'} drawer
        </button>
        {variant === 'note-load-error' && (
          <span>Open the drawer, then use Retry to recover the local note.</span>
        )}
        {variant === 'note-save-error' && (
          <span>
            Edit the synthetic note and leave its field. The first save fails; Retry saves the
            retained draft locally.
          </span>
        )}
      </div>
      <DashboardView />
      <FriendDrawer
        friend={open ? friend : null}
        onClose={() => {
          setOpen(false)
          openerRef.current?.focus({ preventScroll: true })
        }}
      />
      <JoinConfirmDialog />
    </main>
  )
}

function JoinScene(): React.JSX.Element {
  const { join } = useJoinInstance()
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

/** The real welcome setup. Finishing or skipping clears the synthetic
 *  `setupPending` flag, so the reader lands in the fixture app like a new
 *  user would; the button outside the window opens setup again. */
function SetupScene(): React.JSX.Element {
  const setupPending = useSettingsStore((s) => s.settings.setupPending)
  if (setupPending) return <SetupWizard />
  return (
    <>
      <div className="fixture-controls">
        <button
          type="button"
          onClick={() => useSettingsStore.getState().updateSettings({ setupPending: true })}
        >
          Open welcome setup again
        </button>
      </div>
      <AppShell />
    </>
  )
}

function Scene({ name, variant }: { name: string; variant: string }): React.JSX.Element {
  // Synthetic persistence recovery: the retry only settles fixture memory.
  useEffect(() => {
    if (name !== 'settings' || variant !== 'save-error') return
    return useSettingsStore.subscribe((state, previous) => {
      if (state.saveAttempt !== previous.saveAttempt) state.markSaved()
    })
  }, [name, variant])
  useApplyTheme()
  useApplyGlow()
  if (name === 'login')
    return (
      <LoginScreen initialTwoFactor={variant === 'totp' || variant === 'email' ? variant : null} />
    )
  if (name === 'drawer')
    return (
      <DrawerScene
        variant={variant}
        platform={variant === 'chilloutvr' ? 'chilloutvr' : 'vrchat'}
      />
    )
  if (name === 'join') return <JoinScene />
  if (name === 'setup') return <SetupScene />
  if (
    ['dashboard', 'hot', 'friends', 'activity', 'inbox', 'linked', 'settings', 'updater'].includes(
      name
    )
  )
    return <AppShell />
  return (
    <main className="fixture-canvas">
      <CatalogScene scene={name} variant={variant} />
    </main>
  )
}

export function mountScene(root: HTMLElement, params: URLSearchParams): void {
  const name = params.get('scene') ?? 'dashboard'
  const variant = params.get('variant') ?? 'ready'
  const glowParam = params.get('glow')
  const glow: BackgroundGlow =
    glowParam === 'off' || glowParam === 'muted' || glowParam === 'vivid' ? glowParam : 'standard'
  queryClient.clear()
  queryClient.setDefaultOptions({
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      staleTime: Infinity,
      // Cache-only production readers have no Query observer. Keep seeded
      // fixtures alive for this document without adding refreshes or polling.
      gcTime: Infinity
    }
  })
  // `needs-code`: a saved VRChat session waiting for a fresh sign-in code
  // while ChilloutVR stays signed in. Its roster is empty, as the app keeps it.
  const needsCode = name === 'dashboard' && variant === 'needs-code'
  for (const platform of ['vrchat', 'chilloutvr'] as const) {
    queryClient.setQueryData(
      authStatusQueryKey(platform),
      // `signed-out` shows the setup sign-in step as a brand-new install sees it.
      name === 'setup' && variant === 'signed-out'
        ? { platform, state: 'unauthenticated' }
        : needsCode && platform === 'vrchat'
          ? {
              platform,
              state: 'needs-2fa',
              accountId: null,
              displayName: null,
              twoFactorMethod: 'totp'
            }
          : fixtureAuth(platform)
    )
    queryClient.setQueryData(
      friendsQueryKey(platform),
      needsCode && platform === 'vrchat' ? [] : friends[platform]
    )
    queryClient.setQueryData(exploreQueryKey(platform), getPlatformSnapshot(platform))
  }
  const rosterFailure = name === 'friends' ? friendsFailureFor(variant) : null
  if (rosterFailure !== null) {
    // Issue 368 states: the fixture bridge rejects this platform's roster, so
    // Retry stays failed. `stale` keeps the seeded list; `missing` drops it.
    const queryKey = friendsQueryKey(rosterFailure.platform)
    if (rosterFailure.kind === 'missing') queryClient.removeQueries({ queryKey })
    queryClient
      .getQueryCache()
      .build(queryClient, { queryKey })
      .setState({
        status: 'error',
        fetchStatus: 'idle',
        error: new Error('Synthetic roster refresh failed'),
        errorUpdateCount: 1
      })
  }
  queryClient.setQueryData(linkedProfilesKey, structuredClone(linkedSnapshot))
  // `empty`: the Activity page before anything has happened.
  queryClient.setQueryData(
    activityKey,
    name === 'activity' && variant === 'empty' ? [] : activityEntries(Date.now())
  )
  queryClient.setQueryData(
    appBackgroundKey,
    params.get('picture') === '1' ? { dataUrl: backgroundPicture } : null
  )
  useSettingsStore.getState().setSettings({
    ...DEFAULT_SETTINGS,
    theme: params.get('theme') === 'light' ? 'light' : 'dark',
    backgroundGlow: glow,
    reconcileInterval: 'manual',
    confirmJoin: true,
    friendAlertScope: alertScopeFor(variant),
    setupPending: name === 'setup',
    dashboardSectionOrder:
      name === 'dashboard' && variant === 'hot-first' ? 'hot-first' : 'popular-first'
  })
  useSettingsStore.getState().hydrate()
  if (name === 'settings' && variant === 'save-error') {
    useSettingsStore.setState({ dirty: true, saveError: true })
  }
  useUiStore
    .getState()
    .setActiveTab(
      name === 'friends' || name === 'linked'
        ? 'friends'
        : name === 'settings'
          ? 'settings'
          : name === 'hot'
            ? 'hot'
            : name === 'activity'
              ? 'activity'
              : name === 'inbox'
                ? 'inbox'
                : 'dashboard'
    )
  document.body.classList.add('fixture-document')
  createRoot(root).render(
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <AppBackdrop />
        <Scene name={name} variant={variant} />
      </ErrorBoundary>
    </QueryClientProvider>
  )
}
