import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8')

describe('main native notification wiring', () => {
  it('includes the packaged app icon on native notifications (VRX-82)', () => {
    expect(source).toContain('new NativeNotification({ title, body, icon })')
  })

  it('keeps the owner-authored hot-instance world and worldless copy (VRX-85)', () => {
    expect(source).toContain(
      '`${alert.friendCount} friends are in ${strippedWorldName} — join them?`'
    )
    expect(source).toContain('`${alert.friendCount} friends are in the same world — join them?`')
  })
})
