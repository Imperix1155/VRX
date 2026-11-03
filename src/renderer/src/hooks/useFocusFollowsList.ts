import { useLayoutEffect, useRef } from 'react'

function listItems(container: HTMLElement | null): HTMLElement[] {
  return [...(container?.querySelectorAll<HTMLElement>('[data-list-key]') ?? [])]
}

/**
 * Keeps keyboard focus in a list whose items can leave by themselves, such as
 * a hot instance whose friends moved on. When the item that held focus leaves
 * and focus fell to the page, it moves to the item now in its place, or the
 * last one, or `fallback`. Focus the user moved elsewhere stays put.
 *
 * Each item carries `data-list-key` with its key; `focusSelector` picks the
 * control inside an item that takes focus.
 */
export function useFocusFollowsList(
  keys: readonly string[],
  container: React.RefObject<HTMLElement | null>,
  focusSelector: string,
  fallback: React.RefObject<HTMLElement | null>
): {
  onFocus: (event: React.FocusEvent<HTMLElement>) => void
  onBlur: (event: React.FocusEvent<HTMLElement>) => void
} {
  const held = useRef<{ key: string; index: number } | null>(null)
  // The keys as one value, so the effect runs when they change, not on
  // every render's new array.
  const signature = keys.join('\n')
  useLayoutEffect(() => {
    const was = held.current
    if (was === null) return
    const items = listItems(container.current)
    const index = items.findIndex((item) => item.dataset.listKey === was.key)
    if (index >= 0) {
      // Still here, perhaps moved: note where, so it hands over to its
      // neighbour if it leaves later.
      held.current = { key: was.key, index }
      return
    }
    held.current = null
    const active = document.activeElement
    if (active !== null && active !== document.body) return
    const item = items[Math.min(was.index, items.length - 1)]
    const target = item?.querySelector<HTMLElement>(focusSelector) ?? fallback.current
    target?.focus({ preventScroll: true })
  }, [signature, container, focusSelector, fallback])

  return {
    onFocus: (event) => {
      const item = event.target.closest<HTMLElement>('[data-list-key]')
      const key = item?.dataset.listKey
      if (item == null || key === undefined) return
      held.current = { key, index: Math.max(0, listItems(container.current).indexOf(item)) }
    },
    onBlur: (event) => {
      // Focus that moved on to somewhere else is the user's; only a fall to
      // the page (no next target) keeps the note.
      const next = event.relatedTarget
      if (next instanceof Node && !container.current?.contains(next)) held.current = null
    }
  }
}
