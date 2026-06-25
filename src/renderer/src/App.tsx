import AppShell from './components/AppShell'
import LoginScreen from './components/LoginScreen'
import { useAuthStatus } from './queries/auth'

function App(): React.JSX.Element {
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
