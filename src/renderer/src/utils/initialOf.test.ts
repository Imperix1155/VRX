import { describe, expect, it } from 'vitest'
import { initialOf } from './initialOf'

describe('initialOf', () => {
  it('keeps emoji and styled letters whole and falls back for blank names', () => {
    expect(initialOf('  aurora')).toBe('A')
    expect(initialOf('🌸Sakura')).toBe('🌸')
    expect(initialOf('𝓙osh')).toBe('𝓙')
    expect(initialOf('こまどアバター')).toBe('こ')
    expect(initialOf('   ')).toBe('?')
  })
})
