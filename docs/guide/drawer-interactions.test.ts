// @vitest-environment jsdom
import type { Root } from 'react-dom/client'
import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '@renderer/i18n'
import { queryClient } from '@renderer/queries/queryClient'
import { createFixtureBridge } from './fixture-bridge'
import { mountScene } from './scene-renderer'

const roots: Root[] = []
vi.mock('react-dom/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-dom/client')>()
  return {
    ...actual,
    createRoot: (...args: Parameters<typeof actual.createRoot>) => {
      const root = actual.createRoot(...args)
      roots.push(root)
      return root
    }
  }
})

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount()
  })
  queryClient.clear()
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

describe.each(['VRChat', 'ChilloutVR'])('%s guide drawer', (platform) => {
  it.each(['Close', 'Escape', 'outside pointer'])(
    'restores opener focus after %s',
    async (action) => {
      vi.stubGlobal('vrx', createFixtureBridge('ready'))
      const container = document.createElement('div')
      document.body.append(container)
      const variant = platform === 'ChilloutVR' ? 'chilloutvr' : 'vrchat'
      await act(async () => {
        mountScene(container, new URLSearchParams({ scene: 'drawer', variant }))
      })

      const opener = screen.getByRole('button', { name: `Open ${platform} drawer` })
      expect(screen.queryByRole('dialog')).toBeNull()
      await act(async () => {
        opener.focus()
        fireEvent.click(opener)
      })
      const close = screen.getByRole('button', { name: /Close/ })
      expect(document.activeElement).toBe(close)

      await act(async () => {
        if (action === 'Close') fireEvent.click(close)
        else if (action === 'Escape') fireEvent.keyDown(close, { key: 'Escape' })
        else fireEvent.pointerDown(screen.getByRole('main'))
      })
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(document.activeElement).toBe(opener)
    }
  )
})
