/// <reference types="node" />

import { readFileSync, readdirSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const rendererRoot = join(process.cwd(), 'src/renderer')
const rendererSource = join(rendererRoot, 'src')
const tokenDeclaration = join(rendererSource, 'assets/main.css')
const css = readFileSync(tokenDeclaration, 'utf8')
const sourceExtensions = new Set([
  '.css',
  '.html',
  '.js',
  '.jsx',
  '.less',
  '.sass',
  '.scss',
  '.ts',
  '.tsx'
])
const tailwindColorChannels = String.raw`(?:accent|bg|border(?:-[xytrblse])?|caret|decoration|divide(?:-[xy])?|fill|from|outline|placeholder|ring(?:-offset)?|shadow|stroke|text|to|via)`
const tailwindPalette = String.raw`(?:amber|black|blue|cyan|emerald|fuchsia|gray|green|indigo|lime|neutral|orange|pink|purple|red|rose|sky|slate|stone|teal|violet|white|yellow|zinc)`
const cssNamedColors = String.raw`(?:aliceblue|antiquewhite|aqua|aquamarine|azure|beige|bisque|black|blanchedalmond|blue|blueviolet|brown|burlywood|cadetblue|chartreuse|chocolate|coral|cornflowerblue|cornsilk|crimson|cyan|darkblue|darkcyan|darkgoldenrod|darkgray|darkgreen|darkgrey|darkkhaki|darkmagenta|darkolivegreen|darkorange|darkorchid|darkred|darksalmon|darkseagreen|darkslateblue|darkslategray|darkslategrey|darkturquoise|darkviolet|deeppink|deepskyblue|dimgray|dimgrey|dodgerblue|firebrick|floralwhite|forestgreen|fuchsia|gainsboro|ghostwhite|gold|goldenrod|gray|green|greenyellow|grey|honeydew|hotpink|indianred|indigo|ivory|khaki|lavender|lavenderblush|lawngreen|lemonchiffon|lightblue|lightcoral|lightcyan|lightgoldenrodyellow|lightgray|lightgreen|lightgrey|lightpink|lightsalmon|lightseagreen|lightskyblue|lightslategray|lightslategrey|lightsteelblue|lightyellow|lime|limegreen|linen|magenta|maroon|mediumaquamarine|mediumblue|mediumorchid|mediumpurple|mediumseagreen|mediumslateblue|mediumspringgreen|mediumturquoise|mediumvioletred|midnightblue|mintcream|mistyrose|moccasin|navajowhite|navy|oldlace|olive|olivedrab|orange|orangered|orchid|palegoldenrod|palegreen|paleturquoise|palevioletred|papayawhip|peachpuff|peru|pink|plum|powderblue|purple|rebeccapurple|red|rosybrown|royalblue|saddlebrown|salmon|sandybrown|seagreen|seashell|sienna|silver|skyblue|slateblue|slategray|slategrey|snow|springgreen|steelblue|tan|teal|thistle|tomato|turquoise|violet|wheat|white|whitesmoke|yellow|yellowgreen)`
const rawColorPatterns = [
  new RegExp(String.raw`\b${tailwindColorChannels}-${tailwindPalette}(?:-|\/|\b)`),
  new RegExp(String.raw`\b${tailwindColorChannels}-\[[a-z]+\]`, 'i'),
  new RegExp(
    String.raw`\b(?:color|background(?:-color)?|border(?:-[a-z]+)?|outline|fill|stroke|box-shadow|text-shadow)\s*:\s*${cssNamedColors}\b`,
    'i'
  ),
  /#[\da-f]{3,8}\b/i,
  /\b(?:color|hsla?|hwb|lab|lch|oklab|oklch|rgba?)\s*\(/i
]

function themeBlock(selector: string): string {
  const match = css.match(
    new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*{([^}]+)}`)
  )
  expect(match, `${selector} theme block`).not.toBeNull()
  return match?.[1] ?? ''
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return sourceExtensions.has(extname(entry.name)) ? [path] : []
  })
}

function stripScriptComments(source: string): string {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.JSX, source)
  const chunks: string[] = []

  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (
      token !== ts.SyntaxKind.SingleLineCommentTrivia &&
      token !== ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      chunks.push(scanner.getTokenText())
    }
  }

  return chunks.join('')
}

function scannableCss(source: string, path: string | null): string {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '')
  if (path !== tokenDeclaration) return withoutComments

  return withoutComments.replace(
    /(?:^|(?<=[}\n]))\s*((?::root)|(?:\[data-theme=(?:"light"|'light')\]))\s*{([^{}]*)}/g,
    (_match: string, selector: string, body: string) => {
      const sanitizedBody = body.replace(
        /(--[\w-]+\s*:)\s*[^;]+;/g,
        '$1 var(--raw-color-guard-allowed);'
      )

      return `${selector} {${sanitizedBody}}`
    }
  )
}

function scannableSource(source: string, extension: string, path: string | null): string {
  if (['.css', '.less', '.sass', '.scss'].includes(extension)) return scannableCss(source, path)
  if (extension === '.html') {
    // Strip HTML comments to a fixpoint — a single pass can leave a `<!--`
    // behind on nested/crafted input (CodeQL: incomplete multi-char sanitization).
    let stripped = source
    let prev: string
    do {
      prev = stripped
      stripped = stripped.replace(/<!--[\s\S]*?-->/g, '')
    } while (stripped !== prev)
    return stripped
  }
  return stripScriptComments(source)
}

function rawColorViolations(
  source: string,
  extension = '.tsx',
  path: string | null = null
): string[] {
  const scannable = scannableSource(source, extension, path)
  return rawColorPatterns.flatMap((pattern) => scannable.match(pattern) ?? [])
}

describe('renderer design token contract', () => {
  it.each([':root', "[data-theme='light']"])(
    '%s defines every shared surface and error token',
    (selector) => {
      const block = themeBlock(selector)

      expect(block).toMatch(/--border:\s*[^;]+;/)
      expect(block).toMatch(/--surface-hover:\s*[^;]+;/)
      expect(block).toMatch(/--control-fill:\s*[^;]+;/)
      expect(block).toMatch(/--control-fill-hover:\s*[^;]+;/)
      expect(block).toMatch(/--error:\s*[^;]+;/)
    }
  )

  it.each([
    ['Tailwind palette utility', ['hover:bg', 'white/10'].join('-')],
    ['Tailwind gradient stop', ['from', 'blue-500'].join('-')],
    ['Tailwind placeholder', ['placeholder', 'zinc-400'].join('-')],
    ['Tailwind border axis', ['border-x', 'red-500'].join('-')],
    ['Tailwind ring offset', ['ring-offset', 'slate-950'].join('-')],
    ['Tailwind fill', ['fill', 'emerald-300'].join('-')],
    ['Tailwind stroke', ['stroke', 'amber-700'].join('-')],
    ['arbitrary named color', ['bg-[', 'rebeccapurple', ']'].join('')],
    ['arbitrary hex color', ['border-t-[', '#', '123456', ']'].join('')],
    ['hex literal', ['#', 'f0c'].join('')],
    ['RGB function', ['rgb', '(1 2 3 / 50%)'].join('')],
    ['modern color function', ['oklch', '(50% 0.2 30)'].join('')]
  ])('detects a raw %s', (_name, source) => {
    expect(rawColorViolations(source)).not.toHaveLength(0)
  })

  it.each([
    'bg-[var(--control-fill)]',
    'hover:bg-[var(--control-fill-hover)]',
    'color: var(--text);',
    'motion-safe:transition-colors'
  ])('allows semantic token usage: %s', (source) => {
    expect(rawColorViolations(source)).toEqual([])
  })

  it.each([
    [
      '/* ',
      ['bg', 'red-500'].join('-'),
      ' ',
      ['#', 'fff'].join(''),
      ' ',
      ['rgb', '(1 2 3)'].join(''),
      ' */ bg-[var(--control-fill)]'
    ].join(''),
    ['// ', ['text', 'blue-500'].join('-'), '\ncolor: var(--text);'].join('')
  ])('ignores raw colors in comments: %s', (source) => {
    expect(rawColorViolations(source)).toEqual([])
  })

  it('allows raw color values only in authoritative token declarations', () => {
    const fixture = [
      ':root { --fixture: ',
      ['#', 'fff'].join(''),
      '; } [data-theme="light"] { --fixture: ',
      ['rgb', '(1 2 3)'].join(''),
      '; }'
    ].join('')

    expect(rawColorViolations(fixture, '.css', tokenDeclaration)).toEqual([])
  })

  it('rejects local token declarations outside the authoritative token file', () => {
    const fixture = [':root { --fixture: ', ['#', 'fff'].join(''), '; }'].join('')

    expect(
      rawColorViolations(fixture, '.css', join(rendererSource, 'components/local.css'))
    ).not.toHaveLength(0)
  })

  it.each([
    ['body { background: ', ['#', 'fff'].join(''), '; }'].join(''),
    ['.component { color: ', ['rgb', '(1 2 3)'].join(''), '; }'].join(''),
    [':root { color: ', ['hsl', '(0 0% 0%)'].join(''), '; }'].join(''),
    [':root .component { --fixture: ', ['#', 'fff'].join(''), '; }'].join(''),
    ['[data-theme="light"] .component { --fixture: ', ['#', 'fff'].join(''), '; }'].join('')
  ])('rejects raw component CSS: %s', (source) => {
    expect(
      rawColorViolations(source, '.css', join(rendererSource, 'components/local.css'))
    ).not.toHaveLength(0)
  })

  it('includes renderer entry HTML in the guarded source extensions', () => {
    expect(sourceFiles(rendererRoot)).toContain(join(rendererRoot, 'index.html'))
  })

  it('keeps raw colors out of renderer source except the token declaration', () => {
    const violations = sourceFiles(rendererRoot).flatMap((path) =>
      rawColorViolations(readFileSync(path, 'utf8'), extname(path), path).map(
        (match) => `${relative(rendererRoot, path)}: ${match}`
      )
    )

    expect(violations).toEqual([])
  })

  it('keeps the TokenPreview theme control fill semantic in both states', () => {
    const preview = readFileSync(join(rendererSource, 'components/TokenPreview.tsx'), 'utf8')

    expect(preview).toContain('bg-[var(--control-fill)]')
    expect(preview).toContain('hover:bg-[var(--control-fill-hover)]')
    expect(preview).toContain('p-[var(--space-10)]')
    expect(preview).toContain('gap-[var(--space-8)]')
  })
})
