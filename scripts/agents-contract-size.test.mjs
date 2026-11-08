import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The root contract asks that every root-to-leaf chain of AGENTS.md files stay
// below 32 KiB, so agents that load a bounded amount of instructions still get
// every rule on the path to the file they edit.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LIMIT = 32 * 1024

function contracts() {
  return execFileSync('git', ['ls-files', '-z', '--', 'AGENTS.md', '**/AGENTS.md'], {
    cwd: ROOT,
    encoding: 'utf8'
  })
    .split('\0')
    .filter(Boolean)
}

describe('AGENTS.md contract chains', () => {
  it('keeps every root-to-leaf chain below 32 KiB', () => {
    const files = contracts()
    const size = (file) => readFileSync(join(ROOT, file)).byteLength
    const chains = files.map((file) => {
      const chain = files.filter((other) => {
        const dir = dirname(other)
        return dir === '.' || file.startsWith(`${dir}/`)
      })
      return { leaf: file, bytes: chain.reduce((sum, other) => sum + size(other), 0) }
    })
    expect(chains.length).toBeGreaterThan(1)
    expect(chains.filter((chain) => chain.bytes >= LIMIT)).toEqual([])
  })
})
