import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  findSecretsInLine,
  findSecretsInText,
  scanStagedChanges,
  scanTrackedFiles
} from './check-secrets.mjs'

// Every value that must match is put together here at run time, so this file
// never holds a complete match itself (the scan reads this file too).
const id = ['0f8fad5b', 'd9cb', '469f', 'a165', '70867728950e'].join('-')
const long = (n) => 'Ab3'.repeat(Math.ceil(n / 3)).slice(0, n)
const SAMPLES = {
  'vrchat-auth-cookie': `auth=${'authcookie'}_${id}`,
  'vrchat-two-factor-cookie': `${'twoFactorAuth'}=${long(40)}`,
  'chilloutvr-access-key': `${'accessKey'}: '${long(40)}'`,
  'web-token': `${'eyJ'}${long(20)}.${'eyJ'}${long(20)}.${long(20)}`,
  'private-key': `-----BEGIN RSA ${'PRIVATE KEY'}-----`,
  'github-token': `${'ghp'}_${long(36)}`,
  'npm-token': `${'npm'}_${long(36)}`,
  'cloud-key': `${'AKIA'}${'ABCDEFGHIJKLMNOP'}`,
  'chat-token': `${'xoxb'}-${long(24)}`,
  'model-api-key': `${'sk'}-${long(40)}`,
  'home-folder-path': ['C:', 'Users', 'somebody', 'dev'].join('\\')
}

const temp = []
afterEach(() => {
  for (const dir of temp.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'vrx-secrets-'))
  temp.push(dir)
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' })
  git('init', '-q')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  git('config', 'core.hooksPath', '/dev/null')
  return { dir, git }
}

describe('check-secrets', () => {
  it.each(Object.entries(SAMPLES))('flags a value shaped like a real %s', (rule, sample) => {
    expect(findSecretsInLine(`const value = "${sample}"`)).toContain(rule)
  })

  it('leaves the short made-up values the tests use alone', () => {
    for (const line of [
      "cookie: 'auth=authcookie_test; twoFactorAuth=tfa_1'",
      "accessKey: 'key-1'",
      'Bearer abc.def.ghi',
      'see /home/user/vrx and C:\\Users\\name\\AppData and /Users/dev/vrx',
      'https://example.com/home/dashboard/today and the route /Users/list',
      'C:\\Users\\Public\\Desktop and /home/linuxbrew/.linuxbrew/bin',
      'npm_config_cache and sk-something-short'
    ]) {
      expect(findSecretsInLine(line), line).toEqual([])
    }
  })

  it('reports the line number and the rule, never the value', () => {
    const hits = findSecretsInText(`first\n${SAMPLES['github-token']}\nlast`)
    expect(hits).toEqual([{ line: 2, rule: 'github-token' }])
    expect(JSON.stringify(hits)).not.toContain(SAMPLES['github-token'])
  })

  it('scans tracked files and skips pictures', () => {
    const { dir, git } = repo()
    writeFileSync(join(dir, 'clean.txt'), 'nothing here\n')
    writeFileSync(join(dir, 'leak.txt'), `ok\n${SAMPLES['vrchat-auth-cookie']}\n`)
    writeFileSync(join(dir, 'picture.png'), SAMPLES['private-key'])
    git('add', '.')
    expect(scanTrackedFiles(dir)).toEqual([
      { file: 'leak.txt', line: 2, rule: 'vrchat-auth-cookie' }
    ])
  })

  it('scans only the lines a commit would add', () => {
    const { dir, git } = repo()
    writeFileSync(join(dir, 'notes.txt'), 'one\ntwo\n')
    git('add', '.')
    git('commit', '-q', '-m', 'start')
    writeFileSync(join(dir, 'notes.txt'), `one\ntwo\n${SAMPLES['private-key']}\n`)
    expect(scanStagedChanges(dir)).toEqual([])
    git('add', '.')
    expect(scanStagedChanges(dir)).toEqual([{ file: 'notes.txt', line: 3, rule: 'private-key' }])
  })

  it('finds a home folder path in each spelling', () => {
    const person = 'some' + 'body'
    for (const line of [
      `at /home/${person}/vrx/src/main/index.ts:3`,
      `open /Users/${person}/Library/Logs`,
      `C:\\Users\\${person}\\AppData`,
      `"C:\\\\Users\\\\${person}\\\\AppData"`
    ]) {
      expect(findSecretsInLine(line), line).toEqual(['home-folder-path'])
    }
  })

  it('scans an added line that starts with "++" and survives personal git settings', () => {
    const { dir, git } = repo()
    writeFileSync(join(dir, 'notes.txt'), 'one\n')
    git('add', '.')
    git('commit', '-q', '-m', 'start')
    git('config', 'diff.mnemonicPrefix', 'true')
    writeFileSync(join(dir, 'notes.txt'), `one\n++ ${SAMPLES['private-key']}\n`)
    git('add', '.')
    expect(scanStagedChanges(dir)).toEqual([{ file: 'notes.txt', line: 2, rule: 'private-key' }])
  })

  it('finds nothing in this repository', () => {
    expect(scanTrackedFiles(resolve(import.meta.dirname, '..'))).toEqual([])
  })
})
