export interface PixelDesignToken {
  readonly property: `--${string}`
  /** Isolated tests and pre-style bootstrap use the shipped token value. */
  readonly fallbackPx: number
}

/** Numeric renderer consumers must resolve layout values through this bridge
 * instead of duplicating the CSS token as an operational component literal. */
export const RENDERER_PIXEL_TOKENS = {
  space1: { property: '--space-1', fallbackPx: 4 }
} as const satisfies Record<string, PixelDesignToken>

export function readPixelDesignToken(token: PixelDesignToken): number {
  const view = typeof document === 'undefined' ? null : document.defaultView
  if (view === null) return token.fallbackPx

  const raw = view
    .getComputedStyle(document.documentElement)
    .getPropertyValue(token.property)
    .trim()
  const match = /^(\d+(?:\.\d+)?)px$/.exec(raw)
  if (match?.[1] === undefined) return token.fallbackPx

  const value = Number(match[1])
  return Number.isFinite(value) ? value : token.fallbackPx
}
