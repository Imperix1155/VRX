/**
 * A held Enter repeats its keydown many times a second, and each repeat
 * presses the focused button or link, or sends the focused field's form,
 * again. A button that keeps focus while it works (`aria-disabled`, not
 * `disabled`) would then run its action once more each time it finished,
 * such as a join, a favorite or a sign-in. Only the first keydown of a held
 * Enter counts; a textarea or editable text still takes repeated new lines.
 */
export function installHeldEnterGuard(document: Document): () => void {
  const ignoreRepeatedEnter = (event: KeyboardEvent): void => {
    if (!event.repeat || event.key !== 'Enter') return
    const target = event.target
    if (target instanceof HTMLTextAreaElement) return
    if (target instanceof HTMLElement && target.isContentEditable) return
    event.preventDefault()
  }

  document.addEventListener('keydown', ignoreRepeatedEnter, true)

  return () => {
    document.removeEventListener('keydown', ignoreRepeatedEnter, true)
  }
}
