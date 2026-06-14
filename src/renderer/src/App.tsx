import LocaleProbe from './components/LocaleProbe'
import TokenPreview from './components/TokenPreview'
import FriendsList from './components/FriendsList'

function App(): React.JSX.Element {
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
