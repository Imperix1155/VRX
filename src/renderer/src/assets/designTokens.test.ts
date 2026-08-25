/// <reference types="node" />

import { readFileSync, readdirSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const rendererRoot = join(process.cwd(), 'src/renderer')
const rendererSource = join(rendererRoot, 'src')
const tokenDeclaration = join(rendererSource, 'assets/main.css')
const rendererEntry = join(rendererRoot, 'index.html')
const fontDirectory = join(rendererSource, 'assets/fonts')
const css = readFileSync(tokenDeclaration, 'utf8')
const indexHtml = readFileSync(rendererEntry, 'utf8')
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

/** Collect every `@layer components { … }` span in (comment-stripped) CSS by
 *  brace-counting. Shared by the .glass / .glass-frosted layer pins. */
function componentsLayerSpans(code: string): Array<[number, number]> {
  const spans: Array<[number, number]> = []
  for (const layer of code.matchAll(/@layer components/g)) {
    const openBrace = code.indexOf('{', layer.index)
    let depth = 0
    for (let i = openBrace; i < code.length; i++) {
      if (code[i] === '{') depth++
      else if (code[i] === '}' && --depth === 0) {
        spans.push([openBrace, i])
        break
      }
    }
  }
  return spans
}

describe('renderer design token contract', () => {
  it.each([
    ['Inter', 'inter-latin-wght-normal.woff2', 'LICENSE-Inter.txt'],
    ['VT323', 'vt323-latin-400-normal.woff2', 'LICENSE-VT323.txt']
  ])('bundles a valid licensed %s WOFF2 face', (_family, fontFile, licenseFile) => {
    const font = readFileSync(join(fontDirectory, fontFile))
    const license = readFileSync(join(fontDirectory, licenseFile), 'utf8')

    expect(font.subarray(0, 4).toString('ascii')).toBe('wOF2')
    expect(font.byteLength).toBeGreaterThan(1_000)
    expect(license).toContain('SIL OPEN FONT LICENSE Version 1.1')
    expect(license).toMatch(/^Copyright /)
  })

  it.each([
    ['Inter', '400 800', 'inter-latin-wght-normal.woff2'],
    ['VT323', '400', 'vt323-latin-400-normal.woff2']
  ])('loads %s from its local WOFF2 asset', (family, weight, fontFile) => {
    const face = css.match(
      new RegExp(`@font-face\\s*{[^}]*font-family:\\s*['"]${family}['"][^}]*}`, 's')
    )?.[0]

    expect(face, `${family} @font-face`).toBeDefined()
    expect(face).toMatch(new RegExp(`font-weight:\\s*${weight.replace(' ', '\\s+')};`))
    expect(face).toContain(`url('./fonts/${fontFile}')`)
    expect(face).toMatch(/format\('woff2(?:-variations)?'\)/)
    expect(face).toMatch(/font-display:\s*swap;/)
  })

  it('restricts renderer fonts to local files', () => {
    const csp = indexHtml.match(/Content-Security-Policy[\s\S]*?content="([^"]+)"/)?.[1]

    expect(csp).toBeDefined()
    expect(csp).toMatch(/(?:^|;)\s*font-src\s+'self'\s*(?:;|$)/)
    expect(indexHtml).not.toMatch(/fonts\.(?:googleapis|gstatic)\.com/)
  })

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

  it('keeps .glass inside @layer components so positioning utilities can win (VRX-225)', () => {
    // The v0.10.0 in-flow-drawer bug: `.glass { position: relative }` as
    // UNLAYERED author CSS beats every Tailwind utility (unlayered > layered),
    // so `glass fixed` computed `relative` and the drawer rendered at the
    // bottom of the list. No runtime test can see a cascade fight (jsdom
    // doesn't cascade), so this structural check is the only available pin:
    // the `.glass` rule must be DECLARED within an `@layer components` block.
    // Comments narrate these exact tokens (the rule documents itself), so scan
    // comment-stripped CSS — matching prose would pin nothing.
    const code = css.replace(/\/\*[\s\S]*?\*\//g, '')
    const spans = componentsLayerSpans(code)
    expect(spans.length).toBeGreaterThan(0)
    // EVERY `.glass` selector must sit inside one of them. Checking only
    // the first occurrence would let a later unlayered `.glass` rule silently
    // re-beat the `fixed` utility (Codex review catch, VRX-225). The selector
    // pattern also matches `.glass-frosted` / `.glass::before` — those must
    // live in the layer too, and they do.
    const occurrences = [...code.matchAll(/\.glass[^{}]*\{/g)]
    expect(occurrences.length).toBeGreaterThan(0)
    for (const occ of occurrences) {
      const at = occ.index
      expect(
        spans.some(([start, end]) => at > start && at < end),
        `.glass rule at index ${at} is OUTSIDE @layer components — it would beat position utilities again`
      ).toBe(true)
    }
  })

  it('keeps .glass-frosted inside @layer components and on the frost token (VRX-226)', () => {
    // Same cascade reasoning as the .glass pin above: the frosted modifier
    // must live in @layer components (source order after .glass carries the
    // override of the `background:` shorthand's implicit transparent color).
    const code = css.replace(/\/\*[\s\S]*?\*\//g, '')
    const spans = componentsLayerSpans(code)
    expect(spans.length).toBeGreaterThan(0)

    const rule = /\.glass-frosted\s*{([^{}]*)}/g
    const declarations = [...code.matchAll(rule)]
    expect(declarations.length).toBeGreaterThan(0)
    for (const decl of declarations) {
      const at = decl.index
      expect(
        spans.some(([start, end]) => at > start && at < end),
        `.glass-frosted rule at index ${at} is OUTSIDE @layer components`
      ).toBe(true)
      // Var-only (the raw-color guard allows no rgba outside the token
      // blocks): the underlay color comes from the themed --glass-frost token,
      // and BOTH filter longhands consume the frosted blur token.
      expect(decl[1]).toMatch(/background-color:\s*var\(--glass-frost\)\s*;/)
      expect(decl[1]).toMatch(/(?<!-webkit-)backdrop-filter:\s*var\(--glass-blur-frosted\)\s*;/)
      expect(decl[1]).toMatch(/-webkit-backdrop-filter:\s*var\(--glass-blur-frosted\)\s*;/)
    }

    // ORDER is load-bearing, not stylistic: .glass-frosted and .glass share
    // specificity, and .glass's `background:` shorthand resets background-color
    // to transparent — if the modifier ever moves BEFORE .glass, the underlay
    // silently vanishes and list text bleeds through again (Codex review,
    // VRX-226). Assert every base .glass rule precedes every .glass-frosted rule.
    const baseGlass = [...code.matchAll(/\.glass\s*{/g)]
    expect(baseGlass.length).toBeGreaterThan(0)
    const lastBase = Math.max(...baseGlass.map((m) => m.index))
    const firstFrosted = Math.min(...declarations.map((m) => m.index))
    expect(
      firstFrosted,
      '.glass-frosted must come AFTER the base .glass rule (source order carries the override)'
    ).toBeGreaterThan(lastBase)

    // Theme parity: both token blocks must define the frost pair — dropping the
    // light overrides would silently inherit the dark frost.
    const root = css.match(/:root\s*{[\s\S]*?\n}/)?.[0] ?? ''
    const light = css.match(/\[data-theme=['"]light['"]\]\s*{[\s\S]*?\n}/)?.[0] ?? ''
    for (const [name, block] of [
      [':root', root],
      ["[data-theme='light']", light]
    ] as const) {
      expect(block, `${name} token block not found`).not.toBe('')
      expect(block, `${name} is missing --glass-frost`).toContain('--glass-frost:')
      expect(block, `${name} is missing --glass-blur-frosted`).toContain('--glass-blur-frosted:')
    }
  })

  it('keeps .glass-frosted-heavy inside @layer components and on the heavy frost token (VRX-245)', () => {
    const code = css.replace(/\/\*[\s\S]*?\*\//g, '')
    const spans = componentsLayerSpans(code)
    expect(spans.length).toBeGreaterThan(0)

    const rule = /\.glass-frosted-heavy\s*{([^{}]*)}/g
    const declarations = [...code.matchAll(rule)]
    expect(declarations.length).toBeGreaterThan(0)
    for (const decl of declarations) {
      const at = decl.index
      expect(
        spans.some(([start, end]) => at > start && at < end),
        `.glass-frosted-heavy rule at index ${at} is OUTSIDE @layer components`
      ).toBe(true)
      expect(decl[1]).toMatch(/background-color:\s*var\(--glass-frost-heavy\)\s*;/)
      expect(decl[1]).toMatch(/(?<!-webkit-)backdrop-filter:\s*var\(--glass-blur-frosted\)\s*;/)
      expect(decl[1]).toMatch(/-webkit-backdrop-filter:\s*var\(--glass-blur-frosted\)\s*;/)
    }

    // Source order: the heavy modifier must follow the base .glass rule so its
    // background-color override wins over the .glass shorthand.
    const baseGlass = [...code.matchAll(/\.glass\s*{/g)]
    expect(baseGlass.length).toBeGreaterThan(0)
    const lastBase = Math.max(...baseGlass.map((m) => m.index))
    const firstHeavy = Math.min(...declarations.map((m) => m.index))
    expect(
      firstHeavy,
      '.glass-frosted-heavy must come AFTER the base .glass rule (source order carries the override)'
    ).toBeGreaterThan(lastBase)

    // Theme parity for the heavy frost token too — exact values, not just
    // presence (a typo'd or dark-value-in-light copy/paste would still pass
    // a bare "exists" check). Built via join() rather than a literal so the
    // raw-color guard above doesn't flag this fixture as a source violation.
    const root = css.match(/:root\s*{[\s\S]*?\n}/)?.[0] ?? ''
    const light = css.match(/\[data-theme=['"]light['"]\]\s*{[\s\S]*?\n}/)?.[0] ?? ''
    for (const [name, block, value] of [
      [':root', root, ['rgba', '(13, 15, 22, 0.94)'].join('')],
      ["[data-theme='light']", light, ['rgba', '(244, 247, 252, 0.96)'].join('')]
    ] as const) {
      expect(block, `${name} is missing --glass-frost-heavy`).toContain(
        `--glass-frost-heavy: ${value};`
      )
    }
  })
})
