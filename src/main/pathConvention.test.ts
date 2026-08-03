import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const sourceRoot = join(process.cwd(), 'src')
const isSourceFile = (path: string): boolean => /\.tsx?$/.test(path)

const sourceFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return isSourceFile(path) ? [path] : []
  })

const backslash = String.fromCharCode(92)
const escapedBackslash = `${backslash}${backslash}`
const hardcodedPathPattern = new RegExp(
  [
    `(?:^|[^A-Za-z])[A-Za-z]:[/${escapedBackslash}]`,
    `file:${'///'}[A-Za-z]:[/${escapedBackslash}]`,
    `${escapedBackslash}${escapedBackslash}[A-Za-z0-9_.-]{2,}${escapedBackslash}${escapedBackslash}[A-Za-z0-9_.-]+`,
    `%${'APPDATA'}%`,
    `%${'LOCALAPPDATA'}%`,
    `%${'USERPROFILE'}%`,
    `/${'Users'}/`,
    `/${'home'}/`,
    `\\b${'homedir'}\\(`,
    `process\\.env(?:\\.${'HOME'}|\\[\\s*['"]${'HOME'}['"]\\s*\\])`,
    `~${'/'}`
  ].join('|')
)

const stripComments = (source: string): string => {
  let stripped = ''
  let quote: '"' | "'" | '`' | null = null
  let inBlockComment = false

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    const next = source[index + 1]

    if (inBlockComment) {
      if (char === '*' && next === '/') {
        stripped += '  '
        index += 1
        inBlockComment = false
      } else {
        stripped += char === '\n' ? '\n' : ' '
      }
      continue
    }

    if (quote !== null) {
      stripped += char
      if (char === backslash && next !== undefined) {
        stripped += next
        index += 1
      } else if (char === quote) {
        quote = null
      }
      continue
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char
      stripped += char
    } else if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') {
        stripped += ' '
        index += 1
      }
      if (source[index] === '\n') stripped += '\n'
    } else if (char === '/' && next === '*') {
      stripped += '  '
      index += 1
      inBlockComment = true
    } else {
      stripped += char
    }
  }

  return stripped
}

describe('main path conventions (VRX-99)', () => {
  it('rejects known hardcoded local path patterns outside comments', () => {
    const violations: string[] = []

    for (const file of sourceFiles(sourceRoot)) {
      for (const [index, line] of stripComments(readFileSync(file, 'utf8')).split('\n').entries()) {
        if (hardcodedPathPattern.test(line)) {
          violations.push(`${relative(process.cwd(), file)}:${index + 1}: ${line.trim()}`)
        }
      }
    }

    expect(violations, `Hardcoded path convention violations:\n${violations.join('\n')}`).toEqual(
      []
    )
  })
})
