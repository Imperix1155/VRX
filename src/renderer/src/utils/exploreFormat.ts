/**
 * Display helpers for Explore counts and room regions.
 */
import type { Platform } from '@shared/types'

const numberFormats = new Map<string, Intl.NumberFormat>()

/** Formats a count with the UI language's digit grouping. */
export function formatCount(value: number, language: string | undefined): string {
  const locale = language ?? 'en'
  let format = numberFormats.get(locale)
  if (format === undefined) {
    format = new Intl.NumberFormat(locale)
    numberFormats.set(locale, format)
  }
  return format.format(value)
}

// VRChat room ids carry `~region(us|use|usw|eu|jp)`; plain `us` is US West.
const VRCHAT_REGION_KEYS: Readonly<Record<string, string>> = {
  us: 'explore.region.usWest',
  usw: 'explore.region.usWest',
  use: 'explore.region.usEast',
  eu: 'explore.region.europe',
  jp: 'explore.region.japan'
}

// ChilloutVR's region field is optional and loosely specified; only plain
// country or continent codes get a name.
const CHILLOUTVR_REGION_KEYS: Readonly<Record<string, string>> = {
  us: 'explore.region.us',
  eu: 'explore.region.europe',
  jp: 'explore.region.japan'
}

/** Translation key for a room's region, or null when the code is unknown. */
export function regionLabelKey(platform: Platform, region: string | null): string | null {
  if (region === null) return null
  const keys = platform === 'vrchat' ? VRCHAT_REGION_KEYS : CHILLOUTVR_REGION_KEYS
  return keys[region.trim().toLowerCase()] ?? null
}
