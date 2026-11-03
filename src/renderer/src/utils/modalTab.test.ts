// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { keepTabInModal } from './modalTab'

function setup(): {
  outside: HTMLButtonElement
  panel: HTMLDivElement
  buttons: HTMLButtonElement[]
} {
  document.body.innerHTML = `
    <button id="outside">outside</button>
    <div id="panel" tabindex="-1">
      <p>text</p>
      <button id="a">a</button><button id="b">b</button><button id="c">c</button>
    </div>`
  const panel = document.getElementById('panel') as HTMLDivElement
  return {
    outside: document.getElementById('outside') as HTMLButtonElement,
    panel,
    buttons: Array.from(panel.querySelectorAll('button'))
  }
}

function tab(
  panel: HTMLElement,
  focusables: HTMLElement[],
  shiftKey = false
): { prevented: boolean } {
  const result = { prevented: false }
  keepTabInModal({ shiftKey, preventDefault: () => (result.prevented = true) }, panel, focusables)
  return result
}

describe('keepTabInModal', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('brings focus from outside the panel, or the panel itself, to the first control', () => {
    const { outside, panel, buttons } = setup()
    for (const from of [outside, panel]) {
      for (const shiftKey of [false, true]) {
        from.focus()
        expect(tab(panel, buttons, shiftKey).prevented).toBe(true)
        expect(document.activeElement).toBe(buttons[0])
      }
    }
  })

  it('wraps at either end and leaves the steps between to the browser', () => {
    const { panel, buttons } = setup()
    const [a, b, c] = buttons as [HTMLButtonElement, HTMLButtonElement, HTMLButtonElement]
    c.focus()
    expect(tab(panel, buttons).prevented).toBe(true)
    expect(document.activeElement).toBe(a)
    expect(tab(panel, buttons, true).prevented).toBe(true)
    expect(document.activeElement).toBe(c)
    b.focus()
    expect(tab(panel, buttons).prevented).toBe(false)
    expect(tab(panel, buttons, true).prevented).toBe(false)
    expect(document.activeElement).toBe(b)
  })

  it('holds focus on the panel when nothing in it can take focus', () => {
    const { outside, panel } = setup()
    outside.focus()
    expect(tab(panel, []).prevented).toBe(true)
    expect(document.activeElement).toBe(panel)
    expect(tab(panel, [], true).prevented).toBe(true)
    expect(document.activeElement).toBe(panel)
  })
})
