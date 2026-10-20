/**
 * Ctrl+Q quit shortcut for Windows and Linux.
 *
 * VRX removes Electron's default app menu there (see app.ts), and that menu was
 * what made Ctrl+Q quit. Closing the window only hides it to the tray, and some
 * Linux desktops (GNOME without an AppIndicator extension) show no tray, so
 * without this the user had no in-app way to quit at all.
 */
export interface QuitShortcutInput {
  type: string
  key: string
  control: boolean
  alt: boolean
  shift: boolean
  meta: boolean
}

export function isQuitShortcut(input: QuitShortcutInput): boolean {
  return (
    input.type === 'keyDown' &&
    input.control &&
    !input.alt &&
    !input.shift &&
    !input.meta &&
    input.key.toLowerCase() === 'q'
  )
}
