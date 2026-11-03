// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { useEffect, useRef, useState } from 'react'
import { afterEach, expect, it } from 'vitest'
import { useFocusFollowsList } from './useFocusFollowsList'

afterEach(cleanup)

function List({ keys }: { keys: string[] }): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null)
  const fallback = useRef<HTMLButtonElement>(null)
  const follow = useFocusFollowsList(keys, container, 'button', fallback)
  return (
    <>
      <button ref={fallback}>Fallback</button>
      <div ref={container} onFocus={follow.onFocus} onBlur={follow.onBlur}>
        {keys.map((key) => (
          <div key={key} data-list-key={key}>
            <button>{key}</button>
          </div>
        ))}
      </div>
    </>
  )
}

it('hands focus to the neighbour of where the item is now, after others joined above it', () => {
  const view = render(<List keys={['A', 'B']} />)
  screen.getByRole('button', { name: 'B' }).focus()
  view.rerender(<List keys={['X', 'Y', 'A', 'B']} />)
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'B' }))
  view.rerender(<List keys={['X', 'Y', 'A']} />)
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'A' }))
})

it('follows an item the list moved before it leaves', () => {
  const view = render(<List keys={['A', 'B', 'C']} />)
  screen.getByRole('button', { name: 'A' }).focus()
  view.rerender(<List keys={['B', 'C', 'A']} />)
  view.rerender(<List keys={['B', 'C']} />)
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'C' }))
})

it('falls back when the list empties, and leaves focus the user moved elsewhere', () => {
  const view = render(<List keys={['A']} />)
  screen.getByRole('button', { name: 'A' }).focus()
  view.rerender(<List keys={[]} />)
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Fallback' }))

  view.rerender(<List keys={['A', 'B']} />)
  screen.getByRole('button', { name: 'A' }).focus()
  screen.getByRole('button', { name: 'Fallback' }).focus()
  view.rerender(<List keys={['B']} />)
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Fallback' }))
})

const live: { setKeys: (keys: string[]) => void } = { setKeys: () => undefined }

function LiveList({ initial }: { initial: string[] }): React.JSX.Element {
  const [keys, setKeys] = useState(initial)
  useEffect(() => {
    live.setKeys = setKeys
  }, [])
  return <List keys={keys} />
}

it('moves focus in the same commit that takes the focused item away', async () => {
  render(<LiveList initial={['A', 'B']} />)
  screen.getByRole('button', { name: 'A' }).focus()
  // Outside act, React commits and runs passive effects in separate tasks, as
  // in the app, so focus moved by a passive effect would still be on the page
  // when this observer first sees A gone.
  let focusWhenGone: Element | null | undefined
  const observer = new MutationObserver(() => {
    if (focusWhenGone === undefined && screen.queryByRole('button', { name: 'A' }) === null)
      focusWhenGone = document.activeElement
  })
  observer.observe(document.body, { childList: true, subtree: true })
  const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  const previous = actEnvironment.IS_REACT_ACT_ENVIRONMENT
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  try {
    live.setKeys(['B'])
    await waitFor(() => expect(focusWhenGone).toBeDefined())
  } finally {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = previous
    observer.disconnect()
  }
  expect(focusWhenGone).toBe(screen.getByRole('button', { name: 'B' }))
})
