import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { ciVerdict, isOnMain } from './require-green-ci.mjs'

function run(overrides) {
  return {
    name: 'ci-success',
    app: { slug: 'github-actions' },
    status: 'completed',
    conclusion: 'success',
    started_at: '2026-10-19T10:00:00Z',
    html_url: 'https://example.invalid/run',
    ...overrides
  }
}

describe('release CI gate', () => {
  it('waits until ci-success exists and has finished', () => {
    expect(ciVerdict([]).state).toBe('pending')
    expect(ciVerdict([run({ status: 'in_progress', conclusion: null })]).state).toBe('pending')
  })

  it('passes only on a successful Actions-owned ci-success run', () => {
    expect(ciVerdict([run({})]).state).toBe('success')
    expect(ciVerdict([run({ app: { slug: 'some-other-app' } })]).state).toBe('pending')
    expect(ciVerdict([run({ name: 'build' })]).state).toBe('pending')
  })

  it.each(['failure', 'cancelled', 'timed_out', 'skipped', 'neutral'])(
    'fails on a %s conclusion',
    (conclusion) => {
      expect(ciVerdict([run({ conclusion })]).state).toBe('failure')
    }
  )

  it('lets the newest run decide between a failure and a re-run', () => {
    const failed = run({ conclusion: 'failure', started_at: '2026-10-19T10:00:00Z' })
    const passed = run({ started_at: '2026-10-19T11:00:00Z' })
    expect(ciVerdict([failed, passed]).state).toBe('success')
    expect(
      ciVerdict([passed, run({ conclusion: 'failure', started_at: '2026-10-19T12:00:00Z' })]).state
    ).toBe('failure')
  })

  it('accepts only commits main already contains', () => {
    expect(isOnMain('identical')).toBe(true)
    expect(isOnMain('behind')).toBe(true)
    expect(isOnMain('ahead')).toBe(false)
    expect(isOnMain('diverged')).toBe(false)
  })

  it('runs the gate before the tag is created and before any build', () => {
    const workflow = readFileSync('.github/workflows/release.yml', 'utf8')
    const gate = workflow.indexOf('node scripts/require-green-ci.mjs')
    expect(gate).toBeGreaterThan(-1)
    expect(gate).toBeLessThan(workflow.indexOf('-f ref="refs/tags/$TAG"'))
    expect(gate).toBeLessThan(workflow.indexOf('npx electron-builder'))
    expect(workflow).toMatch(/permissions:\n\s+contents: write\n\s+checks: read/)
  })
})
