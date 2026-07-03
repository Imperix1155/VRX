import AppShell from './components/AppShell'
import LoginScreen from './components/LoginScreen'
import { useAuthStatus } from './queries/auth'
import { useApplyTheme } from './hooks/useApplyTheme'
import { useLiveFriendEvents } from './hooks/useLiveFriendEvents'

function App(): React.JSX.Element {
  // Apply the stored theme before any view renders (must be top-level, no early return above).
  useApplyTheme()
  // Live WS events → query cache (VRX-146). Top-level like useApplyTheme: the
  // subscription is idempotent and event application no-ops until a friends
  // fetch has populated the cache (which only happens once authenticated).
  useLiveFriendEvents()

  const { data: authStatus, isPending } = useAuthStatus()

  // While the auth check is in flight, render nothing (avoids flashing login
  // form for an already-authenticated session).
  if (isPending) return <></>

  if (authStatus?.state !== 'authenticated') {
    // needs-2fa: the session's auth cookie is alive, only the second factor
    // expired — jump straight to the code prompt (no password re-entry, VRX-173).
    return (
      <LoginScreen
        // key: a needs-2fa ↔ unauthenticated transition while mounted must
        // remount (re-seed) the screen — the seed is read once at first render.
        key={authStatus?.state ?? 'pending'}
        initialTwoFactor={
          authStatus?.state === 'needs-2fa' ? (authStatus.twoFactorMethod ?? 'totp') : null
        }
      />
    )
  }

  return <AppShell />
}

export default App
