#!/usr/bin/env node
// Secret guard: a small scan that needs nothing installed.
//
//   node scripts/check-secrets.mjs            every tracked file
//   node scripts/check-secrets.mjs --staged   only what `git commit` would add
//
// gitleaks in CI is the full scan (`.gitleaks.toml`). This one exists so the
// same mistake is caught earlier, on any computer, with or without gitleaks:
// `npm test` runs it over the tracked files (scripts/check-secrets.test.mjs)
// and the pre-commit hook runs it over the staged changes.
//
// It reports the file, the line and the kind of value. It never prints the
// value itself, so its output is safe to paste into a PR or a log.
//
// A hit on a made-up test value: build that value at run time in the test
// (`'authcookie_' + id`) so the file never holds a complete match, or use an
// obviously fake short value such as `authcookie_test`.
//
// A hit on a path (`home-folder-path`): the line names a folder inside
// someone's home folder. Write the path with a stand-in name instead:
// `/home/user/...`, `/Users/name/...`, `C:\Users\name\...`, or `<you>`.
// PLACEHOLDER_NAMES below is the full list.
//
// Do not add a file to SKIPPED_FILES to silence a hit.
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

/** Stand-in account names a path may use. Anything else reads as a real person's folder. */
const PLACEHOLDER_NAMES = [
  'name',
  'user',
  'username',
  'yourname',
  'YourName',
  'you',
  'me',
  'dev',
  'example',
  // Accounts that belong to a system or a CI runner, not to a person.
  'runner',
  'runneradmin',
  'linuxbrew',
  'Public',
  'Shared',
  'Default',
  // `vrchat://launch` and world links look like paths to the pattern.
  'world',
  'launch'
]

/**
 * What a real credential looks like. Each pattern needs the full shape of a
 * live value, so short fixtures such as `authcookie_test` never match.
 */
export const SECRET_RULES = [
  { id: 'vrchat-auth-cookie', pattern: new RegExp(`authcookie_${UUID}`, 'i') },
  { id: 'vrchat-two-factor-cookie', pattern: /twoFactorAuth=[A-Za-z0-9._-]{24,}/ },
  {
    id: 'chilloutvr-access-key',
    pattern: /access[_-]?key["']?\s*[:=]\s*["'`][A-Za-z0-9+/=_-]{32,}["'`]/i
  },
  {
    id: 'web-token',
    pattern: /\beyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/
  },
  { id: 'private-key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { id: 'github-token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})/ },
  { id: 'npm-token', pattern: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { id: 'cloud-key', pattern: /\b(?:AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35})\b/ },
  { id: 'chat-token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{20,}/ },
  { id: 'model-api-key', pattern: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{32,}/ },
  {
    // A pasted path that names a person's account on their own computer: a
    // home folder root, an account name, then something inside it. A web
    // address or a route such as `example.com/home/page` or `/Users/list` is
    // not one (nothing may sit right before the root, and a folder must follow).
    id: 'home-folder-path',
    pattern: new RegExp(
      String.raw`(?:[A-Za-z]:\\{1,2}Users\\{1,2}|(?<![A-Za-z0-9._-])/Users/|(?<![A-Za-z0-9._-])/home/)` +
        String.raw`(?!(?:${PLACEHOLDER_NAMES.join('|')}|\.\.\.|<)(?![A-Za-z0-9]))` +
        String.raw`[A-Za-z0-9._-]+[\\/]`
    )
  }
]

/** Never read: binary or generated files where a match means nothing. */
const SKIPPED_FILES = /\.(?:png|ico|icns|woff2?|ttf|otf|jpg|jpeg|gif|webp|bmp)$/i
const MAX_FILE_BYTES = 4 * 1024 * 1024

/** Every rule that matches one line, by id. */
export function findSecretsInLine(line) {
  return SECRET_RULES.filter((rule) => rule.pattern.test(line)).map((rule) => rule.id)
}

/** `{ line, rule }` for every match in a file's text. Line numbers start at 1. */
export function findSecretsInText(text) {
  const hits = []
  const lines = text.split('\n')
  for (let index = 0; index < lines.length; index++) {
    for (const rule of findSecretsInLine(lines[index])) hits.push({ line: index + 1, rule })
  }
  return hits
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
}

/** Scan every tracked file under `root`. */
export function scanTrackedFiles(root) {
  const hits = []
  for (const file of git(['ls-files', '-z'], root).split('\0')) {
    if (file === '' || SKIPPED_FILES.test(file)) continue
    const path = resolve(root, file)
    let text
    try {
      if (statSync(path).size > MAX_FILE_BYTES) continue
      text = readFileSync(path, 'utf8')
    } catch {
      continue // deleted in the working tree, or a submodule entry
    }
    for (const hit of findSecretsInText(text)) hits.push({ file, ...hit })
  }
  return hits
}

/** Scan only the lines the staged changes add. */
export function scanStagedChanges(root) {
  const hits = []
  let file = ''
  let line = 0
  // The `-c` settings pin the output shape, whatever the developer's own git
  // configuration says: `a/` and `b/` prefixes and plain (unquoted) file names.
  const diff = git(
    [
      '-c',
      'diff.mnemonicPrefix=false',
      '-c',
      'diff.noprefix=false',
      '-c',
      'core.quotePath=false',
      'diff',
      '--cached',
      '--no-color',
      '--no-ext-diff',
      '-U0'
    ],
    root
  )
  // A file's header ends at its first `@@`. After that, a row starting with
  // `+++ ` is an added line of text (one that began with `++ `), not a header.
  let inHunk = false
  for (const row of diff.split('\n')) {
    if (row.startsWith('diff --git ')) {
      inHunk = false
      continue
    }
    if (!inHunk && row.startsWith('+++ ')) {
      file = row.slice(4).replace(/^b\//, '')
      continue
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(row)
    if (hunk) {
      inHunk = true
      line = Number(hunk[1])
      continue
    }
    if (!inHunk || !row.startsWith('+') || SKIPPED_FILES.test(file)) continue
    for (const rule of findSecretsInLine(row.slice(1))) hits.push({ file, line, rule })
    line++
  }
  return hits
}

function main() {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
  const staged = process.argv.includes('--staged')
  const hits = staged ? scanStagedChanges(root) : scanTrackedFiles(root)
  if (hits.length === 0) {
    console.log(`check-secrets: OK (${staged ? 'staged changes' : 'tracked files'})`)
    return
  }
  console.error('check-secrets: these lines look like a real credential or a personal path:')
  for (const hit of hits) console.error(`  ${hit.file}:${hit.line}  ${hit.rule}`)
  console.error(
    'For home-folder-path, write the path with a stand-in name such as /home/user/ or C:\\Users\\name\\.'
  )
  console.error(
    'Remove the value. If it is a real credential, it is already compromised: sign out of that\n' +
      'account or revoke the token, and tell the owner. See scripts/check-secrets.mjs for fixtures.'
  )
  process.exitCode = 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
