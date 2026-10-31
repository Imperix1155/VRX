import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isAllowedUrl } from '../ipc/url-allowlist'
import {
  buildBugReportUrl,
  describeInstall,
  describeSystem,
  type BugReportEnvironment
} from './bugReport'

const windows: BugReportEnvironment = {
  version: '1.3.0-dev.1',
  platform: 'win32',
  release: '10.0.22631',
  arch: 'x64',
  packaged: true,
  portable: false,
  appImage: false
}

describe('bug report link', () => {
  it('opens the bug report form with version, install and system filled in', () => {
    const url = new URL(buildBugReportUrl(windows))
    expect(url.origin + url.pathname).toBe('https://github.com/Imperix1155/VRX/issues/new')
    expect([...url.searchParams.keys()]).toEqual(['template', 'version', 'install', 'os'])
    expect(url.searchParams.get('template')).toBe('bug_report.yml')
    expect(url.searchParams.get('version')).toBe('1.3.0-dev.1')
    expect(url.searchParams.get('install')).toBe('Windows installer')
    expect(url.searchParams.get('os')).toBe('Windows 11 (10.0.22631, x64)')
    expect(isAllowedUrl(url.href)).toBe(true)
  })

  it('names each install type', () => {
    expect(describeInstall({ ...windows, portable: true })).toBe('Windows portable')
    expect(describeInstall({ ...windows, platform: 'linux', appImage: true })).toBe(
      'Linux AppImage'
    )
    expect(describeInstall({ ...windows, platform: 'linux' })).toBe('Linux deb')
    expect(describeInstall({ ...windows, platform: 'darwin' })).toBe('macOS test build')
    expect(describeInstall({ ...windows, packaged: false })).toBe('Development build')
  })

  it('tells Windows 10 from Windows 11 and names Linux by kernel', () => {
    expect(describeSystem({ ...windows, release: '10.0.19045' })).toBe(
      'Windows 10 (10.0.19045, x64)'
    )
    expect(describeSystem({ ...windows, platform: 'linux', release: '6.8.0-45-generic' })).toBe(
      'Linux (kernel 6.8.0-45-generic, x64)'
    )
  })

  it('keeps odd values short and plain', () => {
    const url = new URL(
      buildBugReportUrl({ ...windows, platform: 'linux', release: `6.1&os=<x>${'9'.repeat(200)}` })
    )
    const os = url.searchParams.get('os') ?? ''
    expect(os).not.toMatch(/[&<>=]/)
    expect(os.length).toBeLessThan(120)
    expect([...url.searchParams.keys()]).toEqual(['template', 'version', 'install', 'os'])
  })
})

describe('bug report form', () => {
  it('has a field for every value the link fills in', () => {
    const form = readFileSync(
      resolve(process.cwd(), '.github/ISSUE_TEMPLATE/bug_report.yml'),
      'utf8'
    )
    const url = new URL(buildBugReportUrl(windows))
    for (const key of url.searchParams.keys()) {
      if (key === 'template') continue
      expect(form).toMatch(new RegExp(`^ {4}id: ${key}$`, 'm'))
    }
  })
})
