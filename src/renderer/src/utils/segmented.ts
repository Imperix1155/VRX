/**
 * Keyboard helpers for segmented controls (radiogroup + roving tabindex —
 * audit W5). Shared by the TopBar platform filter and the SettingsView theme
 * control so both speak the same WAI-ARIA radio-group dialect: one Tab stop,
 * Left/Up = previous, Right/Down = next, wrapping at the ends.
 */

/**
 * The index an arrow key moves the selection to, or `null` when the key is not
 * an arrow (letting the event proceed untouched).
 *
 * LTR assumption: ArrowRight = next. Fine for the shipped locales (en/ja are
 * both LTR); if an RTL locale (ar/he) ever lands, the horizontal arrows must
 * flip with text direction per the APG radio pattern.
 */
export function segArrowTarget(key: string, index: number, length: number): number | null {
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (index + 1) % length
    case 'ArrowLeft':
    case 'ArrowUp':
      return (index - 1 + length) % length
    default:
      return null
  }
}

/**
 * Move focus to the radio at `index` within the same group as `current`.
 * Selection follows focus (the handler updates state); this keeps the roving
 * tabindex usable — after re-render only the new selection is tabbable.
 * Scoped by the enclosing radiogroup (not parentElement) so a radio later
 * gaining a wrapper element doesn't silently break the lookup.
 */
export function focusRadioSibling(current: HTMLElement, index: number): void {
  const radios = current
    .closest('[role="radiogroup"]')
    ?.querySelectorAll<HTMLElement>('[role="radio"]')
  radios?.[index]?.focus()
}
