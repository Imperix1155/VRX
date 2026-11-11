import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  LAUNCHED_AT_LOGIN_ARG,
  LoginItem,
  buildAutostartEntry,
  type LoginItemDeps
} from './loginItem'

type Query = { path?: string; args?: string[] }

// Spelled in pieces so the path guard (pathConvention.test.ts) reads no real folder.
const WIN_EXE = ['X:', 'Apps', 'VRX', 'vrx.exe'].join('/')
const WIN_PORTABLE = ['X:', 'Downloads', 'vrx-portable.exe'].join('/')

/** A stand-in computer: a login-item registry and a few files. */
function rig(overrides: Partial<LoginItemDeps> = {}): {
  item: LoginItem
  files: Map<string, string>
  registry: Map<string, boolean>
  setLoginItemSettings: ReturnType<typeof vi.fn>
  write: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
  warn: ReturnType<typeof vi.fn>
} {
  const files = new Map<string, string>()
  const registry = new Map<string, boolean>()
  const keyOf = (query: Query = {}): string => `${query.path ?? ''}|${(query.args ?? []).join(' ')}`
  const setLoginItemSettings = vi.fn((next: { openAtLogin: boolean } & Query) => {
    registry.set(keyOf(next), next.openAtLogin)
  })
  const write = vi.fn((path: string, content: string) => void files.set(path, content))
  const remove = vi.fn((path: string) => void files.delete(path))
  const warn = vi.fn()
  const item = new LoginItem({
    platform: 'win32',
    isPackaged: true,
    execPath: WIN_EXE,
    env: {},
    argv: ['vrx.exe'],
    configPath: () => '/config',
    getLoginItemSettings: (query) => ({ openAtLogin: registry.get(keyOf(query)) === true }),
    setLoginItemSettings,
    files: {
      read: (path) => files.get(path) ?? null,
      write,
      makeFolder: () => undefined,
      remove
    },
    warn,
    ...overrides
  })
  return { item, files, registry, setLoginItemSettings, write, remove, warn }
}

// Joined the way the service joins it, so the tests also hold where the separator differs.
const ENTRY_FILE = join('/config', 'autostart', 'vrx.desktop')

describe('LoginItem on Windows', () => {
  it('registers this copy with the launch marker, and reads it back as on', () => {
    const r = rig()
    expect(r.item.status()).toBe('off')
    expect(r.item.sync(true)).toBe('on')
    expect(r.setLoginItemSettings).toHaveBeenCalledExactlyOnceWith({
      openAtLogin: true,
      path: WIN_EXE,
      args: [LAUNCHED_AT_LOGIN_ARG]
    })
    expect(r.item.status()).toBe('on')
  })

  it('writes nothing when the computer already matches', () => {
    const r = rig()
    r.item.sync(false)
    expect(r.setLoginItemSettings).not.toHaveBeenCalled()
    r.item.sync(true)
    r.item.sync(true)
    expect(r.setLoginItemSettings).toHaveBeenCalledTimes(1)
  })

  it('turns it off again', () => {
    const r = rig()
    r.item.sync(true)
    expect(r.item.sync(false)).toBe('off')
    expect(r.setLoginItemSettings).toHaveBeenLastCalledWith({
      openAtLogin: false,
      path: WIN_EXE,
      args: [LAUNCHED_AT_LOGIN_ARG]
    })
  })

  it('starts the real file of a portable copy, not its unpacked one', () => {
    const r = rig({ env: { PORTABLE_EXECUTABLE_FILE: WIN_PORTABLE } })
    r.item.sync(true)
    expect(r.setLoginItemSettings).toHaveBeenCalledWith(
      expect.objectContaining({ path: WIN_PORTABLE })
    )
  })

  it('reports off, with one pathless warning, when the computer refuses', () => {
    const r = rig({
      setLoginItemSettings: () => {
        throw new Error(`${WIN_EXE} denied`)
      }
    })
    expect(r.item.sync(true)).toBe('off')
    expect(r.warn).toHaveBeenCalledExactlyOnceWith('could not change the start-with-computer entry')
  })

  it('reads a failing status check as off', () => {
    const r = rig({
      getLoginItemSettings: () => {
        throw new Error('registry')
      }
    })
    expect(r.item.status()).toBe('off')
  })
})

describe('LoginItem on macOS', () => {
  it('uses the plain login item and knows a sign-in launch', () => {
    const r = rig({
      platform: 'darwin',
      getLoginItemSettings: () => ({ openAtLogin: false, wasOpenedAtLogin: true })
    })
    r.item.sync(true)
    expect(r.setLoginItemSettings).toHaveBeenCalledExactlyOnceWith({ openAtLogin: true })
    expect(r.item.wasLaunchedAtLogin()).toBe(true)
  })
})

describe('LoginItem on Linux', () => {
  const linux = (overrides: Partial<LoginItemDeps> = {}): ReturnType<typeof rig> =>
    rig({ platform: 'linux', execPath: '/opt/VRX/vrx', ...overrides })

  it('writes an autostart entry for this copy and reads it back as on', () => {
    const r = linux()
    expect(r.item.sync(true)).toBe('on')
    expect(r.files.get(ENTRY_FILE)).toBe(buildAutostartEntry('/opt/VRX/vrx'))
    expect(r.files.get(ENTRY_FILE)).toContain(`Exec="/opt/VRX/vrx" ${LAUNCHED_AT_LOGIN_ARG}\n`)
    expect(r.setLoginItemSettings).not.toHaveBeenCalled()
  })

  it('starts the AppImage file itself', () => {
    const r = linux({
      execPath: '/tmp/.mount_vrxAbC/vrx',
      env: { APPIMAGE: '/apps/vrx-1.AppImage' }
    })
    r.item.sync(true)
    expect(r.files.get(ENTRY_FILE)).toContain('Exec="/apps/vrx-1.AppImage" ')
  })

  it('rewrites the entry when an update renamed the AppImage', () => {
    const files = new Map([[ENTRY_FILE, buildAutostartEntry('/apps/vrx-1.AppImage')!]])
    const r = linux({
      env: { APPIMAGE: '/apps/vrx-2.AppImage' },
      files: {
        read: (path) => files.get(path) ?? null,
        write: (path, content) => void files.set(path, content),
        makeFolder: () => undefined,
        remove: (path) => void files.delete(path)
      }
    })
    expect(r.item.status()).toBe('off')
    expect(r.item.sync(true)).toBe('on')
    expect(files.get(ENTRY_FILE)).toContain('vrx-2.AppImage')
  })

  it('does not touch the file on a launch that already matches', () => {
    const r = linux()
    r.item.sync(true)
    r.item.sync(true)
    expect(r.write).toHaveBeenCalledTimes(1)
  })

  it('removes its own entry when turned off', () => {
    const r = linux()
    r.item.sync(true)
    expect(r.item.sync(false)).toBe('off')
    expect(r.files.has(ENTRY_FILE)).toBe(false)
  })

  it('removes its own entry on Off even when it starts another copy of VRX', () => {
    // An update renamed the AppImage; the entry VRX wrote still starts the old file.
    const files = new Map([[ENTRY_FILE, buildAutostartEntry('/apps/vrx-1.AppImage')!]])
    const remove = vi.fn((path: string) => void files.delete(path))
    const r = linux({
      env: { APPIMAGE: '/apps/vrx-2.AppImage' },
      files: {
        read: (path) => files.get(path) ?? null,
        write: (path, content) => void files.set(path, content),
        makeFolder: () => undefined,
        remove
      }
    })
    expect(r.item.status()).toBe('off')
    expect(r.item.sync(false)).toBe('off')
    expect(remove).toHaveBeenCalledExactlyOnceWith(ENTRY_FILE)
    expect(files.has(ENTRY_FILE)).toBe(false)
    // Nothing left to do on the next launch.
    r.item.sync(false)
    expect(remove).toHaveBeenCalledTimes(1)
  })

  it('stays off quietly when the file cannot be read', () => {
    const r = linux({
      files: {
        read: () => {
          throw new Error('EACCES')
        },
        write: () => undefined,
        makeFolder: () => undefined,
        remove: () => undefined
      }
    })
    expect(r.item.sync(false)).toBe('off')
  })

  it("leaves an entry it did not write, even one with VRX's file name", () => {
    const r = linux()
    r.files.set(ENTRY_FILE, '[Desktop Entry]\nType=Application\nExec=/usr/bin/other\n')
    expect(r.item.sync(false)).toBe('off')
    expect(r.remove).not.toHaveBeenCalled()
    expect(r.files.get(ENTRY_FILE)).toContain('/usr/bin/other')
  })

  it('reports off when the entry cannot be written', () => {
    const r = linux({
      files: {
        read: () => null,
        write: () => {
          throw new Error('EACCES /config/autostart')
        },
        makeFolder: () => undefined,
        remove: () => undefined
      }
    })
    expect(r.item.sync(true)).toBe('off')
    expect(r.warn).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(r.warn.mock.calls)).not.toContain('/config')
  })

  it('is unavailable for a path it cannot write safely', () => {
    const r = linux({ execPath: '/opt/VRX\n/vrx' })
    expect(r.item.status()).toBe('unavailable')
    expect(r.item.sync(true)).toBe('unavailable')
    expect(r.write).not.toHaveBeenCalled()
  })
})

describe('LoginItem everywhere', () => {
  it('registers nothing from a development run', () => {
    for (const platform of ['win32', 'darwin', 'linux'] as const) {
      const r = rig({ platform, isPackaged: false, execPath: '/opt/electron' })
      expect(r.item.status()).toBe('unavailable')
      expect(r.item.sync(true)).toBe('unavailable')
      expect(r.setLoginItemSettings).not.toHaveBeenCalled()
      expect(r.write).not.toHaveBeenCalled()
    }
  })

  it('is unavailable on a system it has no startup entry for', () => {
    expect(rig({ platform: 'freebsd' }).item.sync(true)).toBe('unavailable')
  })

  it('knows a sign-in launch by its marker', () => {
    expect(rig().item.wasLaunchedAtLogin()).toBe(false)
    expect(rig({ argv: ['vrx.exe', LAUNCHED_AT_LOGIN_ARG] }).item.wasLaunchedAtLogin()).toBe(true)
    expect(rig({ platform: 'linux', execPath: '/opt/VRX/vrx' }).item.wasLaunchedAtLogin()).toBe(
      false
    )
  })

  it('acts on a saved choice only when it changed', () => {
    const r = rig()
    r.item.follow(true)
    r.item.follow(true)
    expect(r.setLoginItemSettings).toHaveBeenCalledTimes(1)
    // Turned off outside VRX: an unrelated settings save does not put it back.
    r.registry.clear()
    r.item.follow(true)
    expect(r.setLoginItemSettings).toHaveBeenCalledTimes(1)
    r.item.follow(false)
    r.item.follow(true)
    expect(r.setLoginItemSettings).toHaveBeenCalledTimes(2)
  })
})

describe('buildAutostartEntry', () => {
  it('quotes the command the way the Desktop Entry specification asks', () => {
    expect(buildAutostartEntry('/home dir/My Apps/vrx.AppImage')).toContain(
      'Exec="/home dir/My Apps/vrx.AppImage" --launched-at-login'
    )
    expect(buildAutostartEntry('/a/we"ird`$\\%/vrx')).toContain(
      'Exec="/a/we\\\\"ird\\\\`\\\\$\\\\\\\\%%/vrx" --launched-at-login'
    )
  })

  it('refuses a relative path or one with a line break or control character', () => {
    expect(buildAutostartEntry('vrx')).toBeNull()
    expect(buildAutostartEntry('')).toBeNull()
    expect(buildAutostartEntry('/opt/vrx\nExec=/bin/sh')).toBeNull()
    expect(buildAutostartEntry('/opt/vrx\u0000')).toBeNull()
    expect(buildAutostartEntry('/opt/vrx\u007f')).toBeNull()
  })

  it('is a one-command application entry and nothing more', () => {
    const lines = buildAutostartEntry('/opt/VRX/vrx')!.trimEnd().split('\n')
    expect(lines[0]).toBe('[Desktop Entry]')
    expect(lines.filter((line) => line.startsWith('Exec='))).toHaveLength(1)
    expect(lines).toContain('Type=Application')
    expect(lines).toContain('Terminal=false')
  })
})
