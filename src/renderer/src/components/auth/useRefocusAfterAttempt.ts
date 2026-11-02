import { useEffect, useRef } from 'react'

/**
 * An attempt disables a sign-in form's fields, which drops focus to the page.
 * When the attempt fails and the form stays up, focus goes back to `target()`
 * and its text is selected, so the next try replaces the rejected text instead
 * of adding to it (a masked password would hide the join). Focus the user moved
 * elsewhere meanwhile stays where it is.
 */
export function useRefocusAfterAttempt(
  isSubmitting: boolean,
  target: () => HTMLElement | null
): void {
  const attempted = useRef(false)
  useEffect(() => {
    if (isSubmitting) {
      attempted.current = true
      return
    }
    if (!attempted.current) return
    attempted.current = false
    const active = document.activeElement
    if (active !== null && active !== document.body) return
    const element = target()
    element?.focus({ preventScroll: true })
    if (element instanceof HTMLInputElement) element.select()
  }, [isSubmitting, target])
}
