// @vitest-environment jsdom
/**
 * Tests for the applyTheme pure helper (VRX-170).
 *
 * Uses the pure `applyTheme` function — no React, no store — so the only
 * dependency is a real DOM (jsdom).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { applyTheme } from './useApplyTheme'

describe('applyTheme', () => {
  beforeEach(() => {
    // Reset to a known baseline — no data-theme attribute.
    document.documentElement.removeAttribute('data-theme')
  })

  it('Light choice sets data-theme="light"', () => {
    applyTheme('light', false)
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('Dark choice removes data-theme', () => {
    document.documentElement.setAttribute('data-theme', 'light')
    applyTheme('dark', false)
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('Dark choice with prefersLight=true still removes data-theme (explicit beats system)', () => {
    applyTheme('dark', true)
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('System + prefersLight=true sets data-theme="light"', () => {
    applyTheme('system', true)
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('System + prefersLight=false removes data-theme', () => {
    document.documentElement.setAttribute('data-theme', 'light')
    applyTheme('system', false)
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })
})
