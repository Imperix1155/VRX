/**
 * Keeps Tab inside a modal's panel. From anywhere that isn't one of
 * `focusables` (outside the panel, or on the panel itself after a press on its
 * text) focus goes to the first of them, or to the panel when none can take
 * it, where Shift+Tab would otherwise leave the modal. From the last it wraps
 * to the first, and Shift+Tab from the first to the last. Callers choose
 * `focusables`: the join confirmation leaves out aria-disabled controls, the
 * Unfriend and Block confirmation keeps its dimmed buttons while it sends.
 */
export function keepTabInModal(
  event: { readonly shiftKey: boolean; preventDefault(): void },
  panel: HTMLElement,
  focusables: readonly HTMLElement[]
): void {
  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  const active = document.activeElement
  let target: HTMLElement | undefined
  if (!focusables.some((element) => element === active)) target = first ?? panel
  else if (event.shiftKey && active === first) target = last
  else if (!event.shiftKey && active === last) target = first
  if (target === undefined) return
  target.focus({ preventScroll: true })
  event.preventDefault()
}
