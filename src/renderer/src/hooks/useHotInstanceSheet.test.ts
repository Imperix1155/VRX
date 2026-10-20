// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { HotInstance } from '../utils/dashboardAggregations'
import { useHotInstanceSheet } from './useHotInstanceSheet'

const hot = { groupKey: 'vrchat:wrld_a:1' } as HotInstance

function button(label: string): HTMLButtonElement {
  const element = document.createElement('button')
  element.textContent = label
  document.body.append(element)
  return element
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('useHotInstanceSheet self-close', () => {
  it('returns focus to the opener when focus fell to the page with the sheet', () => {
    const opener = button('card')
    const { result, rerender } = renderHook(({ list }) => useHotInstanceSheet(list), {
      initialProps: { list: [hot] as readonly HotInstance[] }
    })
    act(() => result.current.openSheet(hot, opener))
    document.body.focus()

    rerender({ list: [] })

    expect(result.current.selectedInstance).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('leaves focus in an open join confirmation when the instance stops being hot', () => {
    const opener = button('card')
    const confirm = button('Join')
    const { result, rerender } = renderHook(({ list }) => useHotInstanceSheet(list), {
      initialProps: { list: [hot] as readonly HotInstance[] }
    })
    act(() => result.current.openSheet(hot, opener))
    confirm.focus()

    rerender({ list: [] })

    expect(result.current.selectedInstance).toBeNull()
    expect(document.activeElement).toBe(confirm)
  })
})
