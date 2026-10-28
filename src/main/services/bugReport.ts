import { NEW_BUG_REPORT_URL } from '@shared/constants'

/**
 * Settings → About → Report a bug. Builds the GitHub link that opens the
 * bug report form (`.github/ISSUE_TEMPLATE/bug_report.yml`) with the app
 * version, install type and system filled in by field id. Only these three
 * values go in: nothing from the user's accounts, files, or computer name.
 */

export interface BugReportEnvironment {
  version: string
  /** `process.platform` */
  platform: string
  /** `os.release()`: the Windows build or the Linux kernel version. */
  release: string
  arch: string
  packaged: boolean
  /** Set by the Windows portable build's launcher. */
  portable: boolean
  /** Set by the Linux AppImage runtime. */
  appImage: boolean
}

const MAX_FIELD_LENGTH = 80

function field(value: string): string {
  return value.replace(/[^\w .()+-]/g, '').slice(0, MAX_FIELD_LENGTH)
}

export function describeInstall(env: BugReportEnvironment): string {
  if (!env.packaged) return 'Development build'
  if (env.platform === 'win32') return env.portable ? 'Windows portable' : 'Windows installer'
  if (env.platform === 'linux') return env.appImage ? 'Linux AppImage' : 'Linux deb'
  if (env.platform === 'darwin') return 'macOS test build'
  return 'Other'
}

export function describeSystem(env: BugReportEnvironment): string {
  const release = field(env.release)
  const arch = field(env.arch)
  if (env.platform === 'win32') {
    // Windows 11 still reports 10.0; its builds start at 22000.
    const build = Number(release.split('.')[2])
    const name = Number.isFinite(build) && build >= 22000 ? 'Windows 11' : 'Windows 10'
    return `${name} (${release}, ${arch})`
  }
  if (env.platform === 'linux') return `Linux (kernel ${release}, ${arch})`
  if (env.platform === 'darwin') return `macOS (Darwin ${release}, ${arch})`
  return `${field(env.platform)} (${release}, ${arch})`
}

export function buildBugReportUrl(env: BugReportEnvironment): string {
  const url = new URL(NEW_BUG_REPORT_URL)
  url.searchParams.set('template', 'bug_report.yml')
  url.searchParams.set('version', field(env.version))
  url.searchParams.set('install', describeInstall(env))
  url.searchParams.set('os', describeSystem(env))
  return url.href
}
