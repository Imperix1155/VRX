// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { useRef } from 'react'
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
