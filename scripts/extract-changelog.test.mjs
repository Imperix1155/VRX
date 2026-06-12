import { describe, it, expect } from 'vitest'
import { extractSection } from './extract-changelog.mjs'

const SAMPLE = `# Changelog

## [Unreleased]

_Nothing yet._

## [0.1.0] - 2026-06-11

### Added
- Foundation.

## [0.0.1] - 2026-01-01

### Added
- Seed.
`

describe('extractSection', () => {
  it('returns the trimmed body of the requested version', () => {
    expect(extractSection(SAMPLE, '0.1.0')).toBe('### Added\n- Foundation.')
  })

  it('handles the last section (no following heading)', () => {
    expect(extractSection(SAMPLE, '0.0.1')).toBe('### Added\n- Seed.')
  })

  it('returns empty string for a missing version so the pipeline can fall back', () => {
    expect(extractSection(SAMPLE, '9.9.9')).toBe('')
  })

  it('does not treat a "## [" line inside a code fence as a section boundary', () => {
    const fenced = [
      '## [1.0.0]',
      '',
      'Example:',
      '',
      '```',
      '## [Not a release]',
      '```',
      '',
      '- Real entry.',
      '',
      '## [0.9.0]',
      '- old.'
    ].join('\n')
    expect(extractSection(fenced, '1.0.0')).toBe(
      'Example:\n\n```\n## [Not a release]\n```\n\n- Real entry.'
    )
  })
})
