import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const sourceRoot = join(process.cwd(), 'src')
const isSourceFile = (path: string): boolean => /\.tsx?$/.test(path)
const isCommentLine = (line: string): boolean => /^\s*(?:\/\/|\/\*|\*)/.test(line)

const sourceFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return isSourceFile(path) ? [path] : []
  })

const backslash = String.fromCharCode(92)
const hardcodedPathPatterns = [
  new RegExp(`C:${backslash}${backslash}`),
  new RegExp(`%${'APPDATA'}%`),
  new RegExp(`/${'Users'}/`),
  new RegExp(`/${'home'}/`),
  new RegExp(`os\\.${'homedir'}\\(`),
  new RegExp(`process\\.env\\.${'HOME'}`),
  new RegExp(`~${'/'}`)
]

describe('main path conventions (VRX-99)', () => {
  it('rejects hardcoded paths in non-comment source lines', () => {
    const violations: string[] = []

    for (const file of sourceFiles(sourceRoot)) {
      for (const [index, line] of readFileSync(file, 'utf8').split('\n').entries()) {
        if (!isCommentLine(line) && hardcodedPathPatterns.some((pattern) => pattern.test(line))) {
          violations.push(`${relative(process.cwd(), file)}:${index + 1}: ${line.trim()}`)
        }
      }
    }

    expect(violations, `Hardcoded path convention violations:\n${violations.join('\n')}`).toEqual(
      []
    )
  })
})
