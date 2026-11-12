/**
 * Specified-value read-back for inline styles under jsdom 31.
 *
 * jsdom 31 replaced its CSS engine. Reading `element.style.*` now returns the
 * canonical specified value (CSS Values 4): a unitless zero length is `0px`,
 * and calculation children are sorted by unit, so `calc(100vh - 64px)` comes
 * back as `calc(-64px + 100vh)`. The authored declaration is unchanged.
 * Round-tripping the expected string through the same CSSOM keeps the
 * assertion on that declaration instead of one serializer spelling.
 */
export function specifiedInlineStyle(
  property: 'clipPath' | 'minHeight' | 'translate',
  authored: string
): string {
  const probe = document.createElement('div')
  probe.style[property] = authored
  const serialized = probe.style[property]
  if (serialized === '') {
    throw new Error(`CSSOM rejected ${property}: ${authored}`)
  }
  return serialized
}
