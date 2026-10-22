import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const indexHtml = readFileSync('src/renderer/index.html', 'utf8')

function shippedPolicy() {
  const content = indexHtml.match(/Content-Security-Policy[\s\S]*?content="([^"]+)"/)?.[1] ?? ''
  return Object.fromEntries(
    content
      .split(';')
      .map((directive) => directive.trim().split(/\s+/))
      .filter((parts) => parts[0] !== '')
      .map(([name, ...sources]) => [name, sources.join(' ')])
  )
}

describe('renderer Content Security Policy', () => {
  it('ships the exact policy', () => {
    expect(shippedPolicy()).toEqual({
      'default-src': "'self'",
      'script-src': "'self'",
      'style-src': "'self'",
      'font-src': "'self'",
      'img-src': "'self' data:",
      'object-src': "'none'",
      'base-uri': "'none'",
      'form-action': "'none'",
      'frame-src': "'none'"
    })
  })

  it('never allows inline or evaluated code', () => {
    expect(indexHtml).not.toMatch(/'unsafe-(?:inline|eval|hashes)'/)
  })
})
