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
    return <LoginScreen />
  }

  return <AppShell />
}

export default App
