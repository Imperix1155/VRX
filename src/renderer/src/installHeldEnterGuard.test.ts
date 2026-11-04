// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { installHeldEnterGuard } from './installHeldEnterGuard'

const rendererEntrySource = readFileSync(
  join(process.cwd(), 'src/renderer/src/main.tsx'),
  'utf8'
).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')

function press(target: Element, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(event)
  return event
}

describe('installHeldEnterGuard', () => {
  const cleanups: Array<() => void> = []

  afterEach(() => {
    cleanups.splice(0).forEach((cleanup) => cleanup())
    document.body.replaceChildren()
  })

  it('is installed by the production renderer entry', () => {
    expect(rendererEntrySource).toMatch(/^installHeldEnterGuard\(document\)$/m)
  })

  it.each([
    ['a button', '<button type="button">Join</button>', 'button'],
    ['a link', '<a href="#rooms">Rooms</a>', 'a'],
    ['a field whose form Enter sends', '<form><input name="code" /></form>', 'input']
  ])('lets the first Enter on %s through and cancels the held repeats', (_, html, selector) => {
    cleanups.push(installHeldEnterGuard(document))
    document.body.innerHTML = html
    const target = document.querySelector(selector)!

    expect(press(target, { key: 'Enter' }).defaultPrevented).toBe(false)
    expect(press(target, { key: 'Enter', repeat: true }).defaultPrevented).toBe(true)
    expect(press(target, { key: 'Enter', repeat: true }).defaultPrevented).toBe(true)
  })

  it('leaves held Enter in text that takes new lines, and other held keys', () => {
    cleanups.push(installHeldEnterGuard(document))
    document.body.innerHTML =
      '<textarea></textarea><div contenteditable="true"></div><button type="button">Next</button>'
    const editable = document.querySelector<HTMLElement>('[contenteditable]')!
    // jsdom has no editing host model; the app's browser reports this itself.
    Object.defineProperty(editable, 'isContentEditable', { value: true })

    expect(
      press(document.querySelector('textarea')!, { key: 'Enter', repeat: true }).defaultPrevented
    ).toBe(false)
    expect(press(editable, { key: 'Enter', repeat: true }).defaultPrevented).toBe(false)
    expect(
      press(document.querySelector('button')!, { key: 'ArrowDown', repeat: true }).defaultPrevented
    ).toBe(false)
  })

  it('removes its capture listener during cleanup', () => {
    const cleanup = installHeldEnterGuard(document)
    cleanup()
    document.body.innerHTML = '<button type="button">Join</button>'

    expect(
      press(document.querySelector('button')!, { key: 'Enter', repeat: true }).defaultPrevented
    ).toBe(false)
  })
})
