import { useEffect, useRef } from 'react'
import type { AuthState } from '@shared/types'
import AppShell from './components/AppShell'
import LoginScreen from './components/LoginScreen'
import { useAuthStatus } from './queries/auth'
import { useApplyTheme } from './hooks/useApplyTheme'
import { useApplyGlow } from './hooks/useApplyGlow'
import { useLiveFriendEvents } from './hooks/useLiveFriendEvents'
import { useSettingsPersistence } from './hooks/useSettingsPersistence'
import { useSettingsStore } from './stores/settings'
import { useUiStore } from './stores/ui'

function App(): React.JSX.Element {
  // Load persisted settings + save changes (VRX-184) — before useApplyTheme
  // reads the store so the persisted theme lands as early as possible.
  useSettingsPersistence()
  // Apply the stored theme before any view renders (must be top-level, no early return above).
  useApplyTheme()
  // Apply the stored background-glow level before any view renders.
  useApplyGlow()
  const hydrated = useSettingsStore((s) => s.hydrated)
  const notifiedHydrated = useRef(false)
  // This passive effect is declared after both attribute layout effects, so
  // main cannot reveal the CSS canvas until the persisted look is in place.
  useEffect(() => {
    if (
      !hydrated ||
      notifiedHydrated.current ||
      typeof window === 'undefined' ||
      !window.vrx?.notifyRendererHydrated
    ) {
      return
    }
    notifiedHydrated.current = true
    window.vrx.notifyRendererHydrated()
  }, [hydrated])
  // Live WS events + identity boundaries → query cache (VRX-146/24). Top-level
  // like useApplyTheme: the subscription is idempotent and event application
  // no-ops until a friends fetch has populated the cache.
  useLiveFriendEvents()
  // Native hot-instance toast clicks focus the window in main, then push this
  // one-shot navigation request through the preload bridge (VRX-85).
  useEffect(() => {
    if (typeof window === 'undefined' || !window.vrx?.onNavigateToDashboard) return
    return window.vrx.onNavigateToDashboard(() => {
      useUiStore.getState().setActiveTab('dashboard')
    })
  }, [])

  const { data: vrcAuthStatus, isPending: isVrcPending } = useAuthStatus('vrchat')
  const { data: cvrAuthStatus, isPending: isCvrPending } = useAuthStatus('chilloutvr')

  // Platform parity: keep account management reachable while either platform is
  // connected. A VRChat 2FA reprompt is handled inside its AccountCard in-shell.
  // An `error` status also enters the shell (VRX-201): the session may be ALIVE
  // (API outage / schema drift — only the status reply was unreadable), so
  // falling to LoginScreen would invite re-entering credentials and creating a
  // duplicate session. The shell (AccountCard) is where the error is presented.
  const entersShell = (state?: AuthState): boolean => state === 'authenticated' || state === 'error'

  // Hydration gate (VRX-212): do not reveal the UI until the persisted settings
  // load has resolved. An empty tree keeps the default dark canvas visible, so
  // a saved light theme or non-standard glow is applied before anything renders.
  if (!hydrated || isVrcPending || isCvrPending) return <></>

  if (entersShell(vrcAuthStatus?.state) || entersShell(cvrAuthStatus?.state)) {
    return <AppShell />
  }

  // Neither platform is connected. needs-2fa keeps the existing direct VRChat
  // code-prompt route; otherwise LoginScreen starts on credentials as before.
  return (
    <LoginScreen
      // key: a needs-2fa ↔ unauthenticated transition while mounted must
      // remount (re-seed) the screen — the seed is read once at first render.
      key={vrcAuthStatus?.state ?? 'pending'}
      initialTwoFactor={
        vrcAuthStatus?.state === 'needs-2fa' ? (vrcAuthStatus.twoFactorMethod ?? 'totp') : null
      }
    />
  )
}

export default App
