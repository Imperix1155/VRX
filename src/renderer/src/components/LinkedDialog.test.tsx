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
