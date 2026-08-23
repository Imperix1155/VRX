// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { installDocumentDropGuard } from './installDocumentDropGuard'

const rendererEntrySource = readFileSync(
  join(process.cwd(), 'src/renderer/src/main.tsx'),
  'utf8'
).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')

describe('installDocumentDropGuard', () => {
  const cleanups: Array<() => void> = []

  afterEach(() => {
    cleanups.splice(0).forEach((cleanup) => cleanup())
  })

  it('is installed by the production renderer entry', () => {
    expect(rendererEntrySource).toMatch(/^installDocumentDropGuard\(document\)$/m)
  })

  it.each(['dragover', 'drop'] as const)(
    'prevents the document %s default during capture',
    (type) => {
      cleanups.push(installDocumentDropGuard(document))
      const event = new Event(type, { bubbles: true, cancelable: true })

      document.body.dispatchEvent(event)

      expect(event.defaultPrevented).toBe(true)
    }
  )

  it('removes its capture listeners during cleanup', () => {
    const cleanup = installDocumentDropGuard(document)
    cleanup()
    const event = new Event('drop', { bubbles: true, cancelable: true })

    document.body.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
  })
})
