import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { devStyleCspPlugin, relaxStyleCspForDev } from './dev-style-csp'

const indexHtml = readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8')
const csp = indexHtml.match(/Content-Security-Policy[\s\S]*?content="([^"]+)"/)?.[1] ?? ''

describe('renderer CSP (#369)', () => {
  it('ships without unsafe-inline for styles or scripts', () => {
    expect(csp).toMatch(/(?:^|;)\s*style-src\s+'self'\s*(?:;|$)/)
    expect(csp).toMatch(/(?:^|;)\s*script-src\s+'self'\s*(?:;|$)/)
    expect(indexHtml).not.toContain('unsafe-inline')
  })

  it('relaxes style-src only for the dev server', () => {
    const plugin = devStyleCspPlugin()
    expect(plugin.apply).toBe('serve')
    expect(plugin.name).toBe('vrx-dev-style-csp')
    const dev = relaxStyleCspForDev(indexHtml)
    expect(dev).toContain("style-src 'self' 'unsafe-inline';")
    expect(dev).toContain("script-src 'self';")
    expect(dev.match(/unsafe-inline/g)).toHaveLength(1)
  })

  it('fails loudly if the CSP drifts so the dev rewrite would silently no-op', () => {
    expect(() => relaxStyleCspForDev('<meta content="default-src *">')).toThrow(/dev-style-csp/)
  })
})

function rendererSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return rendererSources(path)
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : []
  })
}

describe('renderer style injection guard (#369)', () => {
  // React's style={} goes through the CSSOM, which CSP allows. These do not:
  // <style> elements, HTML style attributes, and raw HTML that could carry them.
  const forbidden = [
    /<style[\s>]/,
    /createElement\(\s*['"]style['"]/,
    /setAttribute\(\s*['"]style['"]/,
    /\.cssText\s*=/,
    /dangerouslySetInnerHTML/,
    /\.innerHTML\s*=/
  ]

  it('production renderer source never injects inline stylesheets or style attributes', () => {
    const root = new URL('../src/renderer/src', import.meta.url).pathname
    const hits = rendererSources(root).flatMap((file) => {
      const text = readFileSync(file, 'utf8')
      return forbidden.filter((re) => re.test(text)).map((re) => `${file}: ${re}`)
    })
    expect(hits).toEqual([])
  })
})
