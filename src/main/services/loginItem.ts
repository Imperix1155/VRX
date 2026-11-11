/**
 * Start VRX with the computer (owner, 2026-11-11).
 *
 * One switch in Settings, mirrored to the operating system:
 * - Windows and macOS: Electron's login item for this copy of VRX.
 * - Linux: an XDG autostart entry (`<config>/autostart/vrx.desktop`), since
 *   Electron has no login item there. The entry is rewritten whenever its
 *   command no longer matches this copy, because an AppImage's file name
 *   changes with every update.
 *
 * Every launch it registers carries {@link LAUNCHED_AT_LOGIN_ARG}, which is
 * how main knows to keep the window in the tray when the user asked for that.
 *
 * Nothing here talks to a platform, and the only file it writes outside VRX's
 * own storage is that one autostart entry, which it removes again only when
 * the entry is its own (also when it was written for another copy of VRX). A development run (not packaged) registers nothing:
 * it would add the bare Electron binary to the user's startup.
 */
import { join } from 'node:path'
import type { LoginItemStatus } from '@shared/ipc'

/** Marks a launch that the operating system made at sign-in. */
export const LAUNCHED_AT_LOGIN_ARG = '--launched-at-login'

const AUTOSTART_FILE = 'vrx.desktop'
/** Tells VRX's own autostart entry from one the user or a package wrote. */
const MANAGED_MARKER = 'X-VRX-Managed=true'

interface LoginItemQuery {
  path?: string
  args?: string[]
}

export interface LoginItemDeps {
  platform: NodeJS.Platform
  isPackaged: boolean
  /** The running binary (`process.execPath`). */
  execPath: string
  /** `APPIMAGE` and `PORTABLE_EXECUTABLE_FILE`: the file the user really runs. */
  env: Readonly<Record<string, string | undefined>>
  argv: readonly string[]
  /** `app.getPath('appData')`: the XDG config folder on Linux. */
  configPath: () => string
  getLoginItemSettings: (query?: LoginItemQuery) => {
    openAtLogin: boolean
    wasOpenedAtLogin?: boolean
  }
  setLoginItemSettings: (settings: { openAtLogin: boolean } & LoginItemQuery) => void
  files: {
    read: (path: string) => string | null
    write: (path: string, content: string) => void
    makeFolder: (path: string) => void
    remove: (path: string) => void
  }
  /** Logged without paths: a path can carry the account name. */
  warn: (message: string) => void
}

/** Characters a Desktop Entry `Exec` value cannot carry inside a quoted argument. */
// eslint-disable-next-line no-control-regex
const UNSAFE_EXEC_PATH = /[\u0000-\u001f\u007f]/

/**
 * The XDG autostart entry that starts `execPath` at sign-in, or null when the
 * path cannot be written safely. Quoting follows the Desktop Entry
 * specification: the argument sits in double quotes with `"`, `` ` ``, `$` and
 * `\` escaped, the backslashes are escaped again for the string value, and
 * `%` is doubled so it is never read as a field code.
 */
export function buildAutostartEntry(execPath: string): string | null {
  if (!execPath.startsWith('/') || UNSAFE_EXEC_PATH.test(execPath)) return null
  const quoted = execPath.replace(/(["`$\\])/g, '\\$1')
  const escaped = quoted.replace(/\\/g, '\\\\').replace(/%/g, '%%')
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Version=1.0',
    'Name=VRX',
    `Exec="${escaped}" ${LAUNCHED_AT_LOGIN_ARG}`,
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    MANAGED_MARKER,
    ''
  ].join('\n')
}

export class LoginItem {
  private lastWanted: boolean | null = null

  constructor(private readonly deps: LoginItemDeps) {}

  /** True when the operating system started this run at sign-in. */
  wasLaunchedAtLogin(): boolean {
    if (this.deps.argv.includes(LAUNCHED_AT_LOGIN_ARG)) return true
    if (this.deps.platform !== 'darwin') return false
    try {
      return this.deps.getLoginItemSettings().wasOpenedAtLogin === true
    } catch {
      return false
    }
  }

  /** What the operating system has now. `unavailable`: this copy cannot register. */
  status(): LoginItemStatus {
    const target = this.target()
    if (target === null) return 'unavailable'
    try {
      if (target.kind === 'autostart') {
        return this.deps.files.read(target.file) === target.entry ? 'on' : 'off'
      }
      return this.deps.getLoginItemSettings(target.query).openAtLogin ? 'on' : 'off'
    } catch {
      return 'off'
    }
  }

  /**
   * Make the operating system match `wanted`. Does nothing when it already
   * does, so a normal launch writes nothing. Returns the status afterwards:
   * `off` while `wanted` is true means the computer refused it.
   */
  sync(wanted: boolean): LoginItemStatus {
    this.lastWanted = wanted
    const target = this.target()
    if (target === null) return 'unavailable'
    const before = this.status()
    // An entry VRX wrote for another copy (an older AppImage name, another
    // folder) reads as `off` here, yet it would still start that copy.
    const stale = !wanted && target.kind === 'autostart' && this.hasManagedEntry(target.file)
    if (before === (wanted ? 'on' : 'off') && !stale) return before
    try {
      if (target.kind === 'autostart') {
        if (wanted) {
          this.deps.files.makeFolder(target.folder)
          this.deps.files.write(target.file, target.entry)
        } else if (this.deps.files.read(target.file)?.includes(MANAGED_MARKER) === true) {
          this.deps.files.remove(target.file)
        }
      } else {
        this.deps.setLoginItemSettings({ openAtLogin: wanted, ...target.query })
      }
    } catch {
      this.deps.warn('could not change the start-with-computer entry')
    }
    return this.status()
  }

  /** True when the autostart file is one VRX wrote, whatever it starts. */
  private hasManagedEntry(file: string): boolean {
    try {
      return this.deps.files.read(file)?.includes(MANAGED_MARKER) === true
    } catch {
      return false
    }
  }

  /** After a settings save: act only when the choice changed. */
  follow(wanted: boolean): void {
    if (this.lastWanted === wanted) return
    this.sync(wanted)
  }

  private target():
    | { kind: 'login-item'; query: LoginItemQuery }
    | { kind: 'autostart'; folder: string; file: string; entry: string }
    | null {
    const { platform, isPackaged, env, execPath } = this.deps
    if (!isPackaged) return null
    if (platform === 'win32') {
      // The portable build unpacks to a temporary folder; start the real file.
      const path = env['PORTABLE_EXECUTABLE_FILE'] || execPath
      return { kind: 'login-item', query: { path, args: [LAUNCHED_AT_LOGIN_ARG] } }
    }
    if (platform === 'darwin') return { kind: 'login-item', query: {} }
    if (platform === 'linux') {
      const entry = buildAutostartEntry(env['APPIMAGE'] || execPath)
      if (entry === null) return null
      const folder = join(this.deps.configPath(), 'autostart')
      return { kind: 'autostart', folder, file: join(folder, AUTOSTART_FILE), entry }
    }
    return null
  }
}
