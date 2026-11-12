/**
 * Reads VRX's design tokens and rules straight from the production stylesheet
 * (`src/renderer/src/assets/main.css`), so the design guide and the token
 * reference in `docs/DESIGN.md` can never drift from the app.
 *
 * Plain TypeScript with no imports and only erasable syntax: the design guide
 * imports it, its test imports it, and `node docs/guide/design-tokens.mjs`
 * runs it directly to rewrite the generated part of `docs/DESIGN.md`.
 */

export interface CssDeclaration {
  readonly name: string
  readonly value: string
}

export interface DesignTokens {
  /** `:root`: the dark theme, which is the stylesheet baseline. */
  readonly dark: readonly CssDeclaration[]
  /** `[data-theme='light']`: the light theme's overrides. */
  readonly light: readonly CssDeclaration[]
  /** `@theme`: the static Tailwind scale (radius and fonts). */
  readonly scale: readonly CssDeclaration[]
}

export interface TokenRow {
  readonly name: string
  readonly dark: string | null
  readonly light: string | null
}

export interface TokenGroup {
  readonly title: string
  readonly rows: readonly TokenRow[]
}

const DESIGN_TOKENS_START = '<!-- design-tokens:start -->'
const DESIGN_TOKENS_END = '<!-- design-tokens:end -->'

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** Index just past the `}` that closes the block opened at `open` (a `{`). */
function closingBrace(css: string, open: number): number {
  let depth = 0
  for (let index = open; index < css.length; index += 1) {
    const char = css[index]
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return index + 1
    }
  }
  return -1
}

/**
 * The first top-level rule whose selector list is exactly `selector`, with its
 * leading comment, as written in the stylesheet. Selector lists are compared
 * after collapsing whitespace, so `.a,\n.b` matches `.a, .b`. Returns null
 * when the stylesheet has no such rule.
 */
export function extractCssRule(css: string, selector: string): string | null {
  const wanted = selector.replace(/\s+/g, ' ').trim()
  // Blank out comments (keeping offsets) so a brace or a word in a comment can
  // never be read as a rule.
  const masked = css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '))
  // A rule's head is the text between the previous `{`, `}` or `;` and its `{`.
  let boundary = -1
  for (let open = 0; open < masked.length; open += 1) {
    const char = masked[open]
    if (char === '}' || char === ';') {
      boundary = open
      continue
    }
    if (char !== '{') continue
    const headStart = boundary + 1
    boundary = open
    const raw = masked.slice(headStart, open)
    if (raw.replace(/\s+/g, ' ').trim() !== wanted) continue
    const start = headStart + (raw.length - raw.trimStart().length)
    const end = closingBrace(masked, open)
    if (end < 0) return null
    const lineStart = css.lastIndexOf('\n', start - 1) + 1
    const indent = css.slice(lineStart, start)
    if (indent.trim() !== '') continue
    const before = css.slice(0, lineStart).trimEnd()
    let comment = ''
    if (before.endsWith('*/')) {
      const commentOpen = before.lastIndexOf('/*')
      const commentLine = before.lastIndexOf('\n', commentOpen - 1) + 1
      if (commentOpen >= 0 && before.slice(commentLine, commentOpen) === indent) {
        comment = `${before.slice(commentLine)}\n`
      }
    }
    return `${comment}${css.slice(lineStart, end)}`
      .split('\n')
      .map((line) => (line.startsWith(indent) ? line.slice(indent.length) : line))
      .join('\n')
  }
  return null
}

/** The custom-property declarations inside the top-level rule for `selector`. */
export function declarationsOf(css: string, selector: string): CssDeclaration[] {
  const rule = extractCssRule(css, selector)
  if (rule === null) return []
  const clean = stripComments(rule)
  const body = clean.slice(clean.indexOf('{') + 1, clean.lastIndexOf('}'))
  const declarations: CssDeclaration[] = []
  let depth = 0
  let current = ''
  for (const char of body) {
    if (char === '(') depth += 1
    if (char === ')') depth -= 1
    if (char === ';' && depth === 0) {
      const colon = current.indexOf(':')
      const name = current.slice(0, colon).trim()
      if (colon > 0 && name.startsWith('--')) {
        declarations.push({
          name,
          value: current
            .slice(colon + 1)
            .replace(/\s+/g, ' ')
            .trim()
        })
      }
      current = ''
      continue
    }
    current += char
  }
  return declarations
}

export function readDesignTokens(css: string): DesignTokens {
  return {
    dark: declarationsOf(css, ':root'),
    light: declarationsOf(css, "[data-theme='light']"),
    scale: declarationsOf(css, '@theme')
  }
}

/** Token families. A token joins the family with its longest matching prefix. */
const GROUPS: readonly { title: string; prefixes: readonly string[] }[] = [
  {
    title: 'Canvas, text and neutral controls',
    prefixes: [
      '--bg-base',
      '--text',
      '--names-lift',
      '--border',
      '--surface-hover',
      '--control-fill',
      '--error',
      '--warning',
      '--favorite',
      '--scrollbar-'
    ]
  },
  {
    title: 'Spacing and shell geometry',
    prefixes: [
      '--space-',
      '--sidebar-width',
      '--content-inset-',
      '--friend-status-',
      '--linked-world-'
    ]
  },
  {
    title: 'Platforms',
    prefixes: [
      '--vrc',
      '--cvr',
      '--bridge',
      '--plat-',
      '--tint-',
      '--platform-row-',
      '--text-on-',
      '--login-tab-',
      '--linked-rail-'
    ]
  },
  { title: 'Presence and VRChat status', prefixes: ['--ingame', '--active', '--offline', '--st-'] },
  { title: 'Instance access, policy space and pills', prefixes: ['--op-', '--policy-', '--pill-'] },
  {
    title: 'Glass material and controls',
    prefixes: ['--glass-', '--scrim', '--control-active-', '--seg-bubble-', '--sidebar-foot-']
  },
  { title: 'Pictures, banners and sheets', prefixes: ['--hot-sheet-', '--group-'] },
  {
    title: 'Aurora glow and scanlines',
    prefixes: ['--aurora-', '--glow-', '--wisp-', '--scanline-']
  },
  { title: 'Welcome setup theme pictures', prefixes: ['--setup-'] }
]

export function groupDesignTokens(tokens: DesignTokens): TokenGroup[] {
  const light = new Map(tokens.light.map((token) => [token.name, token.value]))
  const dark = new Map(tokens.dark.map((token) => [token.name, token.value]))
  const names = [...dark.keys(), ...[...light.keys()].filter((name) => !dark.has(name))]
  const buckets = new Map<string, TokenRow[]>()
  for (const name of names) {
    let title = 'Other'
    let longest = 0
    for (const group of GROUPS) {
      for (const prefix of group.prefixes) {
        if (name.startsWith(prefix) && prefix.length > longest) {
          title = group.title
          longest = prefix.length
        }
      }
    }
    const rows = buckets.get(title) ?? []
    rows.push({ name, dark: dark.get(name) ?? null, light: light.get(name) ?? null })
    buckets.set(title, rows)
  }
  return [...GROUPS.map(({ title }) => title), 'Other']
    .filter((title) => buckets.has(title))
    .map((title) => ({ title, rows: buckets.get(title) ?? [] }))
}

function cell(value: string | null): string {
  if (value === null) return '(same as dark)'
  // Markdown table cells: a pipe ends the cell, so it is written as `\|`.
  return `\`${value.split('|').join('\\|')}\``
}

function table(header: readonly string[], rows: readonly (readonly string[])[]): string {
  return [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`)
  ].join('\n')
}

const GLOW_SELECTORS = [
  ["[data-glow='off']", 'Off'],
  ["[data-glow='muted']", 'Muted'],
  ["[data-glow='vivid']", 'Vivid'],
  ["[data-theme='light'][data-glow='muted']", 'Muted, light theme'],
  ["[data-theme='light'][data-glow='vivid']", 'Vivid, light theme']
] as const

const FADE_SELECTORS = [
  [".app-backdrop[data-fade='low']", 'Low, dark'],
  [".app-backdrop[data-fade='medium']", 'Medium, dark'],
  [".app-backdrop[data-fade='high']", 'High, dark'],
  ["[data-theme='light'] .app-backdrop[data-fade='low']", 'Low, light'],
  ["[data-theme='light'] .app-backdrop[data-fade='medium']", 'Medium, light'],
  ["[data-theme='light'] .app-backdrop[data-fade='high']", 'High, light']
] as const

/** The generated Markdown that sits between the token markers in DESIGN.md. */
export function renderDesignTokenReference(css: string): string {
  const tokens = readDesignTokens(css)
  const sections: string[] = [
    DESIGN_TOKENS_START,
    '<!-- Generated from src/renderer/src/assets/main.css by `npm run design:tokens`. Do not edit by hand. -->',
    '<!-- prettier-ignore-start -->'
  ]
  for (const group of groupDesignTokens(tokens)) {
    sections.push(
      `#### ${group.title}`,
      table(
        ['Token', 'Dark (`:root`)', "Light (`[data-theme='light']`)"],
        group.rows.map((row) => [
          `\`${row.name}\``,
          row.dark === null ? '(light only)' : cell(row.dark),
          cell(row.light)
        ])
      )
    )
  }
  sections.push(
    '#### Static scale (`@theme`, same in both themes)',
    table(
      ['Token', 'Value'],
      tokens.scale.map((token) => [`\`${token.name}\``, cell(token.value)])
    ),
    '#### Background glow levels (Standard is the default and sets no attribute)',
    table(
      ['Level', 'Overrides'],
      GLOW_SELECTORS.map(([selector, label]) => [
        `${label} (\`${selector}\`)`,
        declarationsOf(css, selector)
          .map((token) => `\`${token.name}: ${token.value}\``)
          .join(', ')
      ])
    ),
    '#### Background picture fade',
    table(
      ['Fade', 'Overrides'],
      FADE_SELECTORS.map(([selector, label]) => [
        `${label} (\`${selector}\`)`,
        declarationsOf(css, selector)
          .map((token) => `\`${token.name}: ${token.value}\``)
          .join(', ')
      ])
    ),
    '<!-- prettier-ignore-end -->',
    DESIGN_TOKENS_END
  )
  return sections.join('\n\n')
}

/** `doc` with its generated token block replaced by `block`, or null without markers. */
export function replaceDesignTokenReference(doc: string, block: string): string | null {
  const start = doc.indexOf(DESIGN_TOKENS_START)
  const end = doc.indexOf(DESIGN_TOKENS_END)
  if (start < 0 || end < start) return null
  return `${doc.slice(0, start)}${block}${doc.slice(end + DESIGN_TOKENS_END.length)}`
}
