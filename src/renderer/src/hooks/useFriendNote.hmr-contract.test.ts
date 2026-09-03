import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(fileURLToPath(new URL('./useFriendNote.ts', import.meta.url)), 'utf8')

describe('useFriendNote HMR source contract', () => {
  it('restores the transferred coordinator and reinstalls its boundary listener at module load', () => {
    expect(source).toContain('const coordinator: FriendNoteCoordinator = hmrData?.coordinator ?? {')

    const moduleInstall = source.slice(
      source.indexOf('// Preload is available before the production renderer'),
      source.indexOf('// Renderer-lifetime only')
    )
    expect(moduleInstall).toContain('ensureFriendNoteCoordinator()')

    const hmrHandoff = source.slice(source.indexOf('// Vite replaces this module'))
    expect(hmrHandoff).toContain('disposeFriendNoteCoordinatorForHmrTests()')
    expect(hmrHandoff).toContain('data.coordinator = coordinator')
  })
})
