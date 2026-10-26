/**
 * electron-store 12 must keep reading the settings file VRX already writes.
 *
 * The schema migration (including v14 → v15, which exists so `updateChannel`
 * survives a downgrade) lives in `@shared/settings`. This module does not pass
 * conf's `migrations` option. These tests use the real Store and only mock
 * Electron, so a v14 file still becomes v15 with `updateChannel: stable`, and a
 * stored beta or dev channel survives a second process.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const userData = vi.hoisted(() => ({ dir: '' }))
const ipcChannels = vi.hoisted(() => [] as string[])

vi.mock('electron', () => {
  const electron = {
    app: {
      getPath: (name: string) => {
        if (name !== 'userData') throw new Error(`unexpected app path ${name}`)
        return userData.dir
      },
      getVersion: () => '1.0.0'
    },
    ipcMain: {
      on: (channel: string) => {
        ipcChannels.push(channel)
      }
    }
  }
  return { ...electron, default: electron }
})

vi.mock('../logger', () => ({ default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }))

async function loadFromDisk(): Promise<{
  loadSettings: typeof import('./settings').loadSettings
}> {
  vi.resetModules()
  return import('./settings')
}

function readSettingsFile(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(userData.dir, 'settings.json'), 'utf8')) as Record<
    string,
    unknown
  >
}

beforeEach(() => {
  ipcChannels.length = 0
  userData.dir = mkdtempSync(join(tmpdir(), 'vrx-settings-store-'))
})

afterEach(() => {
  rmSync(userData.dir, { recursive: true, force: true })
  userData.dir = ''
  vi.resetModules()
})

describe('electron-store 12 settings file', () => {
  it('migrates a v14 file to v15 and keeps an explicit reconcile interval', async () => {
    writeFileSync(
      join(userData.dir, 'settings.json'),
      JSON.stringify({
        version: 14,
        theme: 'light',
        autoUpdate: true,
        reconcileInterval: '10m',
        language: 'ja'
      })
    )

    const { loadSettings } = await loadFromDisk()
    const loaded = loadSettings()

    expect(loaded).toMatchObject({
      version: 15,
      theme: 'light',
      autoUpdate: true,
      reconcileInterval: '10m',
      language: 'ja',
      updateChannel: 'stable',
      setupPending: false
    })
    expect(ipcChannels).toContain('electron-store-get-data')

    const written = readSettingsFile()
    expect(written).not.toHaveProperty('__internal__')
    expect(written).toEqual(loaded)

    const reread = (await loadFromDisk()).loadSettings()
    expect(reread.updateChannel).toBe('stable')
    expect(reread.reconcileInterval).toBe('10m')
    expect(reread.theme).toBe('light')
    expect(reread.language).toBe('ja')
    expect(readSettingsFile()).toEqual(written)
  })

  it.each(['beta', 'dev'] as const)(
    'round-trips a stored updateChannel of %s',
    async (updateChannel) => {
      writeFileSync(
        join(userData.dir, 'settings.json'),
        JSON.stringify({
          version: 15,
          theme: 'dark',
          autoUpdate: false,
          updateChannel
        })
      )

      const loaded = (await loadFromDisk()).loadSettings()
      expect(loaded.updateChannel).toBe(updateChannel)
      expect(loaded.version).toBe(15)
      expect(readSettingsFile()).toMatchObject({
        version: 15,
        theme: 'dark',
        autoUpdate: false,
        updateChannel
      })
      expect(readSettingsFile()).not.toHaveProperty('__internal__')

      const reread = (await loadFromDisk()).loadSettings()
      expect(reread.updateChannel).toBe(updateChannel)
      expect(readSettingsFile().updateChannel).toBe(updateChannel)
    }
  )

  it('leaves conf bookkeeping in the file and out of the parsed settings', async () => {
    writeFileSync(
      join(userData.dir, 'settings.json'),
      JSON.stringify({
        version: 15,
        updateChannel: 'beta',
        __internal__: { migrations: { version: '9.9.9' } }
      })
    )

    const loaded = (await loadFromDisk()).loadSettings()
    expect(loaded.updateChannel).toBe('beta')
    expect(loaded).not.toHaveProperty('__internal__')
    expect(readSettingsFile().__internal__).toEqual({ migrations: { version: '9.9.9' } })

    const reread = (await loadFromDisk()).loadSettings()
    expect(reread.updateChannel).toBe('beta')
    expect(readSettingsFile().__internal__).toEqual({ migrations: { version: '9.9.9' } })
  })
})
