// @vitest-environment jsdom
/**
 * Tests for the applyGlow pure helper (background-glow setting).
 *
 * Uses the pure `applyGlow` function — no React, no store — so the only
 * dependency is a real DOM (jsdom).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { applyGlow } from './useApplyGlow'

describe('applyGlow', () => {
  beforeEach(() => {
    // Reset to a known baseline — no data-glow attribute.
    document.documentElement.removeAttribute('data-glow')
  })

  it('Standard choice removes data-glow', () => {
    document.documentElement.setAttribute('data-glow', 'vivid')
    applyGlow('standard')
    expect(document.documentElement.hasAttribute('data-glow')).toBe(false)
  })

  it('Muted choice sets data-glow="muted"', () => {
    applyGlow('muted')
    expect(document.documentElement.getAttribute('data-glow')).toBe('muted')
  })

  it('Vivid choice sets data-glow="vivid"', () => {
    applyGlow('vivid')
    expect(document.documentElement.getAttribute('data-glow')).toBe('vivid')
  })

  it('Changing from vivid to standard removes the attribute', () => {
    applyGlow('vivid')
    applyGlow('standard')
    expect(document.documentElement.hasAttribute('data-glow')).toBe(false)
  })

  it('Changing from muted to vivid updates the attribute value', () => {
    applyGlow('muted')
    applyGlow('vivid')
    expect(document.documentElement.getAttribute('data-glow')).toBe('vivid')
  })
})
