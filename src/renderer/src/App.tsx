import LocaleProbe from './components/LocaleProbe'
import TokenPreview from './components/TokenPreview'
import FriendsList from './components/FriendsList'
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

  return (
    <>
      <LocaleProbe />
      <TokenPreview />
      <div className="mx-auto max-w-2xl px-10 pb-10">
        <FriendsList />
      </div>
    </>
  )
}

export default App
