import AppShell from './components/AppShell'
import LoginScreen from './components/LoginScreen'
import { useAuthStatus } from './queries/auth'
import { useApplyTheme } from './hooks/useApplyTheme'

function App(): React.JSX.Element {
  // Apply the stored theme before any view renders (must be top-level, no early return above).
  useApplyTheme()

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
