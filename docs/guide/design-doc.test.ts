import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  declarationsOf,
  extractCssRule,
  readDesignTokens,
  renderDesignTokenReference,
  replaceDesignTokenReference
} from './cssTokens'
import { CSS_SAMPLES, JSX_SAMPLES } from './codeSamples'

const root = resolve(import.meta.dirname, '../..')
const css = readFileSync(resolve(root, 'src/renderer/src/assets/main.css'), 'utf8')
const doc = readFileSync(resolve(root, 'docs/DESIGN.md'), 'utf8')

function rendererSource(): string {
  const dir = resolve(root, 'src/renderer/src')
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
    .map((file) => readFileSync(join(dir, file), 'utf8'))
    .join('\n')
}

function normalizedDeclarations(rule: string): string[] {
  const body = rule.replace(/\/\*[\s\S]*?\*\//g, '')
  return body
    .slice(body.indexOf('{') + 1, body.lastIndexOf('}'))
    .split(';')
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

describe('DESIGN.md stays in step with the stylesheet', () => {
  it('has an up-to-date generated token reference (npm run design:tokens)', () => {
    expect(replaceDesignTokenReference(doc, renderDesignTokenReference(css))).toBe(doc)
  })

  it('reads every theme token block', () => {
    const tokens = readDesignTokens(css)
    expect(tokens.dark.length).toBeGreaterThan(100)
    expect(tokens.light.length).toBeGreaterThan(80)
    expect(tokens.scale.map(({ name }) => name)).toContain('--radius-panel')
    expect(declarationsOf(css, "[data-glow='vivid']").length).toBeGreaterThan(0)
  })

  it('names only tokens that exist', () => {
    const tokens = readDesignTokens(css)
    const known = new Set(
      [...tokens.dark, ...tokens.light, ...tokens.scale].map(({ name }) => name)
    )
    // Variables set by components or rules rather than the theme blocks.
    for (const local of [
      '--instance-pill-bg',
      '--platform-row-color',
      '--platform-row-from',
      '--platform-row-to',
      '--platform-row-border',
      '--app-backdrop-fade',
      '--aurora-floor',
      '--alert-step',
      '--linked-platform',
      '--linked-badge-bg'
    ])
      known.add(local)
    // Skip BEM modifiers such as `.platform-row--vrchat`.
    const named = new Set(doc.match(/(?<![\w-])--[a-z][a-z0-9-]*[a-z0-9]/g) ?? [])
    const unknown = [...named].filter(
      (name) =>
        !known.has(name) &&
        // Family patterns written with a star, such as `--plat-*-badge-*`.
        !doc.includes(`${name}-*`) &&
        !doc.includes(`${name}*`)
    )
    expect(unknown).toEqual([])
  })

  it('copies the material classes in Appendix B.1 from main.css', () => {
    const section = doc.slice(doc.indexOf('### B.1'), doc.indexOf('### B.2'))
    const code = /```css\n([\s\S]*?)```/.exec(section)?.[1] ?? ''
    const selectors = [...code.matchAll(/^([.:\w-][^{]*?)\s*\{/gm)].map((match) =>
      (match[1] ?? '').replace(/\s+/g, ' ').trim()
    )
    expect(selectors.length).toBeGreaterThan(5)
    for (const selector of selectors) {
      const documented = extractCssRule(code, selector)
      const shipped = extractCssRule(css, selector)
      expect(shipped, selector).not.toBeNull()
      const want = normalizedDeclarations(shipped ?? '')
      for (const declaration of normalizedDeclarations(documented ?? '')) {
        // The combined ::after rule documents the sheet's fill in a comment.
        expect(want, `${selector}: ${declaration}`).toContain(declaration)
      }
    }
  })

  it('shows only stylesheet rules that exist in the visual guide', () => {
    for (const { selector } of CSS_SAMPLES) {
      expect(extractCssRule(css, selector), selector).not.toBeNull()
    }
  })

  it('names only material classes that exist', () => {
    const classes = new Set(doc.match(/`\.([a-z][a-z0-9-]*)`/g) ?? [])
    for (const quoted of classes) {
      const name = quoted.slice(2, -1)
      expect(css.includes(`.${name}`), name).toBe(true)
    }
  })

  it('names only real components, helpers and constants in the code samples', () => {
    const source = rendererSource()
    const code = Object.values(JSX_SAMPLES).join('\n')
    const names = new Set([
      ...[...code.matchAll(/<([A-Z][A-Za-z]+)/g)].map((match) => match[1] ?? ''),
      ...[...code.matchAll(/\b([A-Z][A-Z0-9_]{3,})\b/g)].map((match) => match[1] ?? ''),
      ...[...code.matchAll(/\b(apply[A-Z]\w*|\w+For)\(/g)].map((match) => match[1] ?? '')
    ])
    // LABEL_KEYS stands for the caller's own label map.
    names.delete('LABEL_KEYS')
    names.delete('JSX')
    expect(names.size).toBeGreaterThan(10)
    for (const name of names) {
      const exported = new RegExp(
        `export (?:default )?(?:function |const |class |type )?${name}\\b|export \\{[^}]*\\b${name}\\b`
      )
      expect(exported.test(source), name).toBe(true)
    }
  })
})
