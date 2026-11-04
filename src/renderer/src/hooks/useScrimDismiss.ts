import { useRef } from 'react'

/**
 * A modal's backdrop dismiss. A main-button mouse press closes on the press;
 * a touch or pen tap closes on its click, which the backdrop still gets, so
 * the tap doesn't land on whatever is behind once the modal is gone. The press
 * stops at the backdrop: the drawer and the sheets behind close on a press
 * outside them once nothing waits on the modal, which is already true by the
 * time the press would reach them. It is also cancelled, so the browser
 * doesn't move focus to the page after the modal has put it back on the
 * button that opened it.
 */
export function useScrimDismiss(
  enabled: boolean,
  dismiss: () => void
): {
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void
  onClick: () => void
} {
  const tapped = useRef(false)
  return {
    onPointerDown: (event) => {
      event.stopPropagation()
      event.preventDefault()
      tapped.current = false
      if (!enabled || event.button !== 0) return
      if (event.pointerType === 'touch' || event.pointerType === 'pen') tapped.current = true
      else dismiss()
    },
    onClick: () => {
      if (!tapped.current) return
      tapped.current = false
      if (enabled) dismiss()
    }
  }
}
