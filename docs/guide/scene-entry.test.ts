// @vitest-environment jsdom
import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { Root } from 'react-dom/client'

const mounted = vi.hoisted(() => ({ roots: [] as Root[] }))
vi.mock('react-dom/client', async (original) => {
  const actual = await original<typeof import('react-dom/client')>()
  return {
    ...actual,
    createRoot: (...args: Parameters<typeof actual.createRoot>) => {
      const root = actual.createRoot(...args)
      mounted.roots.push(root)
      return root
    }
  }
})

afterEach(async () => {
  await act(async () => {
    for (const root of mounted.roots.splice(0)) root.unmount()
  })
  document.body.replaceChildren()
  document.body.className = ''
  vi.unstubAllGlobals()
})

it('selects the settings save-error scene and resets only its isolated fixture', async () => {
  vi.stubGlobal('__GUIDE_REVISION__', 'synthetic-guide-revision')
  history.replaceState(null, '', '/glass.html?scene=settings&theme=dark')
  document.body.innerHTML = '<div id="root"></div>'
  await act(async () => {
    await import('./scene-entry')
  })
  const frame = screen.getByTitle('settings production components, synthetic data')
  const query = (): URLSearchParams =>
    new URL(frame.getAttribute('src')!, location.href).searchParams
  expect(query().get('render')).toBe('1')
  expect(window.vrx).toBeUndefined()
  fireEvent.change(screen.getByLabelText('State'), { target: { value: 'save-error' } })
  fireEvent.change(screen.getByLabelText('Theme'), { target: { value: 'light' } })
  fireEvent.change(screen.getByLabelText('Glow'), { target: { value: 'muted' } })
  fireEvent.click(screen.getByLabelText('Grayscale'))
  expect(query().get('variant')).toBe('save-error')
  expect(query().get('theme')).toBe('light')
  expect(query().get('glow')).toBe('muted')
  expect(frame.className).toContain('scene-grayscale')
  fireEvent.click(screen.getByRole('button', { name: 'Reset sample' }))
  expect(query().get('reset')).toBe('1')
  expect(query().get('variant')).toBe('save-error')
  expect(window.vrx).toBeUndefined()
  fireEvent.change(screen.getByLabelText('Theme'), { target: { value: 'dark' } })
  fireEvent.click(screen.getByLabelText('Grayscale'))
  expect(query().get('theme')).toBe('dark')
  expect(frame.className).not.toContain('scene-grayscale')
})
