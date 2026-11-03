// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import '../i18n'
import LinkedDialog from './LinkedDialog'

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function (): void {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function (): void {
    this.removeAttribute('open')
  }
})
afterEach(cleanup)
it('opens natively, starts at safe Close and restores its opener', () => {
  const opener = document.createElement('button')
  document.body.append(opener)
  opener.focus()
  const view = render(
    <LinkedDialog title="Identities" onClose={vi.fn()}>
      <button>Dangerous action</button>
    </LinkedDialog>
  )
  expect(screen.getByRole('dialog').hasAttribute('open')).toBe(true)
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }))
  view.unmount()
  expect(document.activeElement).toBe(opener)
  opener.remove()
})
it('owns Escape and does not let dialog interactions close the drawer beneath it', () => {
  const close = vi.fn()
  const outer = vi.fn()
  document.addEventListener('keydown', outer)
  render(
    <LinkedDialog title="Identities" onClose={close}>
      <input aria-label="Name" />
    </LinkedDialog>
  )
  fireEvent.keyDown(screen.getByRole('textbox'), { key: '/' })
  expect(outer).not.toHaveBeenCalled()
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }))
  expect(close).toHaveBeenCalledOnce()
  document.removeEventListener('keydown', outer)
})
it('closes with the same ✕ button as friend details and the sheets', () => {
  render(
    <LinkedDialog title="Identities" onClose={vi.fn()}>
      Body
    </LinkedDialog>
  )
  const close = screen.getByRole('button', { name: 'Close' })
  expect(close.querySelector('[aria-hidden="true"]')?.textContent).toBe('✕')
  expect(close.textContent).toBe('✕')
  expect(close.className).toContain('h-[28px] w-[28px]')
  expect(close.className).toContain('focus:ring-1 focus:ring-[var(--text-dim)]')
})
it('does not dismiss an operation in flight', () => {
  const close = vi.fn()
  render(
    <LinkedDialog title="Identities" busy onClose={close}>
      Saving
    </LinkedDialog>
  )
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }))
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(close).not.toHaveBeenCalled()
})
it('restores the same person opener after its original row has been replaced', () => {
  const row = document.createElement('div')
  row.dataset.personKey = 'person:pair'
  row.innerHTML = '<button data-drawer-opener>Original</button>'
  document.body.append(row)
  row.querySelector('button')!.focus()
  const view = render(
    <LinkedDialog title="Choose" onClose={vi.fn()}>
      Content
    </LinkedDialog>
  )
  const replacement = document.createElement('div')
  replacement.dataset.personKey = 'person:pair'
  replacement.innerHTML = '<button data-drawer-opener>Replacement</button>'
  row.replaceWith(replacement)
  view.unmount()
  expect(document.activeElement).toBe(replacement.querySelector('button'))
  replacement.remove()
})
it('puts focus back on the control that started a save once it settles', () => {
  const dialog = (busy: boolean): React.JSX.Element => (
    <LinkedDialog title="Identities" busy={busy} onClose={vi.fn()}>
      <label>
        <input type="checkbox" disabled={busy} />
        Use merged profile picture
      </label>
    </LinkedDialog>
  )
  const view = render(dialog(false))
  const checkbox = screen.getByRole('checkbox')
  checkbox.focus()
  view.rerender(dialog(true))
  // Chromium drops focus from a control once it is disabled; jsdom keeps it.
  const activeElement = vi.spyOn(document, 'activeElement', 'get').mockReturnValue(document.body)
  const refocus = vi.spyOn(checkbox, 'focus')
  view.rerender(dialog(false))
  activeElement.mockRestore()
  expect(refocus).toHaveBeenCalled()
})
it('follows the browser when it closes the dialog itself, and only then', () => {
  const onClose = vi.fn()
  const view = render(
    <LinkedDialog title="Edit profile" dismissible={false} onClose={onClose}>
      <textarea aria-label="Bio" />
    </LinkedDialog>
  )
  const dialog = screen.getByRole('dialog')
  // A late close event from an earlier close finds the dialog open: nothing.
  fireEvent(dialog, new Event('close'))
  expect(onClose).not.toHaveBeenCalled()
  // After a few Escapes in a row the browser closes it anyway.
  dialog.removeAttribute('open')
  fireEvent(dialog, new Event('close'))
  expect(onClose).toHaveBeenCalledTimes(1)
  // The app's own close on unmount isn't a second request.
  dialog.setAttribute('open', '')
  view.unmount()
  fireEvent(dialog, new Event('close'))
  expect(onClose).toHaveBeenCalledTimes(1)
})
it('keeps the browser from closing a dialog that holds Escape back, and a held-back press keeps focus', () => {
  const onClose = vi.fn()
  const dialog = (state: { busy?: boolean; dismissible?: boolean }): React.JSX.Element => (
    <LinkedDialog title="Edit profile" {...state} onClose={onClose}>
      <textarea aria-label="Bio" />
    </LinkedDialog>
  )
  const view = render(dialog({}))
  const panel = screen.getByRole('dialog')
  expect(panel.getAttribute('closedby')).toBe('closerequest')
  // Holding back typed text: the browser may not close it after a few
  // Escapes, and a press outside is cancelled, so focus stays in the field.
  view.rerender(dialog({ dismissible: false }))
  expect(panel.getAttribute('closedby')).toBe('none')
  expect(fireEvent.pointerDown(panel)).toBe(false)
  expect(fireEvent.pointerDown(screen.getByRole('textbox'))).toBe(true)
  // The same while busy, so nothing closes it in the middle of a change.
  view.rerender(dialog({ busy: true }))
  expect(panel.getAttribute('closedby')).toBe('none')
  expect(fireEvent.pointerDown(panel)).toBe(false)
  expect(onClose).not.toHaveBeenCalled()
  view.rerender(dialog({}))
  expect(panel.getAttribute('closedby')).toBe('closerequest')
  // A press that closes it is cancelled too, so focus lands on the opener
  // instead of moving to what was under the pointer.
  expect(fireEvent.pointerDown(panel)).toBe(false)
  expect(onClose).toHaveBeenCalledTimes(1)
})
it('closes only on a main-button press outside its own box, and a middle press pastes nothing', () => {
  const onClose = vi.fn()
  render(
    <LinkedDialog title="Picked friends" onClose={onClose}>
      <p>Rows</p>
    </LinkedDialog>
  )
  const panel = screen.getByRole('dialog')
  vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue(
    DOMRect.fromRect({ x: 100, y: 100, width: 300, height: 200 })
  )
  // Its own scrollbar, at the right edge inside the box: not outside.
  expect(fireEvent.pointerDown(panel, { button: 0, clientX: 395, clientY: 200 })).toBe(true)
  // A middle press outside keeps focus where it is and doesn't close it, and
  // its release is cancelled so Linux doesn't paste the selection there.
  expect(fireEvent.pointerDown(panel, { button: 1, clientX: 20, clientY: 20 })).toBe(false)
  expect(fireEvent.pointerUp(panel, { button: 1, clientX: 20, clientY: 20 })).toBe(false)
  // So is the release of one that began outside and ends over the panel.
  const words = screen.getByText('Rows')
  expect(fireEvent.pointerDown(panel, { button: 1, pointerId: 1, clientX: 20, clientY: 20 })).toBe(
    false
  )
  expect(fireEvent.pointerUp(words, { button: 1, pointerId: 1 })).toBe(false)
  // A middle press inside, such as on a field to paste into it, stays the user's.
  expect(fireEvent.pointerDown(words, { button: 1, pointerId: 1 })).toBe(true)
  expect(fireEvent.pointerUp(words, { button: 1, pointerId: 1 })).toBe(true)
  expect(onClose).not.toHaveBeenCalled()
  expect(fireEvent.pointerDown(panel, { button: 0, clientX: 20, clientY: 20 })).toBe(false)
  expect(onClose).toHaveBeenCalledTimes(1)
})
