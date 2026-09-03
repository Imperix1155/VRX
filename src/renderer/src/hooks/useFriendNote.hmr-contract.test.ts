import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(fileURLToPath(new URL('./useFriendNote.ts', import.meta.url)), 'utf8')

describe('useFriendNote HMR source contract', () => {
  it('keeps the transferred listener through dispose and swaps it at module load', () => {
    expect(source).toContain('const coordinator: FriendNoteCoordinator = hmrData?.coordinator ?? {')

    const moduleInstall = source.slice(
      source.indexOf('// Preload is available before the production renderer'),
      source.indexOf('// Renderer-lifetime only')
    )
    expect(moduleInstall).toContain(
      'if (hmrData?.coordinator === undefined) ensureFriendNoteCoordinator()'
    )
    expect(moduleInstall).toContain('else replaceFriendNoteCoordinator()')

    const hmrHandoff = source.slice(source.indexOf('// Vite awaits the replacement import'))
    expect(hmrHandoff).not.toContain('removeBoundaryListener')
    expect(hmrHandoff).toContain('data.coordinator = coordinator')
  })
})
