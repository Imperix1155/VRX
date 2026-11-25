/**
 * VRChat `GET /instanceOptions` (community spec `bfafa918`).
 * An instance carries `categoryId`, `displayVibeId` and `vibeIds`.
 * Labels are `categories[].name` and `vibes[].title`. Ids stay here.
 */

/** A success is reused for a day. A bad reply is retried after a minute. */
export const INSTANCE_OPTIONS_CACHE_MS = 24 * 60 * 60 * 1000
export const INSTANCE_OPTIONS_FAILURE_CACHE_MS = 60 * 1000
/** The client allows three vibes. The display vibe leads when it is one of them. */
export const INSTANCE_VIBE_LIMIT = 3

const OPTION_ID_MAX = 80
const LABEL_MAX = 40
const CATALOG_ROW_LIMIT = 48
const VIBE_SCAN_LIMIT = 20

export interface InstanceOptionIds {
  categoryId: string | null
  vibeIds: readonly string[]
}

export interface InstanceOptionCatalog {
  categories: ReadonlyMap<string, string>
  vibes: ReadonlyMap<string, string>
}

export interface InstanceOptionLabels {
  category: string | null
  vibes: readonly string[]
}

type RecordValue = Record<string, unknown>

function record(value: unknown): RecordValue | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as RecordValue)
    : null
}

/** An own-property id. Blank, huge, or whitespace-bearing values are ignored. */
function optionId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const id = value.trim()
  if (id.length === 0 || id.length > OPTION_ID_MAX) return null
  for (const char of id) {
    const code = char.codePointAt(0) ?? 0
    if (code <= 32 || code === 127) return null
  }
  return id
}

/** One line of display text. Control characters go, and the result is clipped. */
function labelText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  let visible = ''
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    if ((code >= 0 && code <= 31) || code === 127) continue
    visible += char
  }
  const cleaned = visible.replace(/\s+/g, ' ').trim()
  if (cleaned.length === 0) return null
  const points = Array.from(cleaned)
  if (points.length <= LABEL_MAX) return points.join('')
  return `${points.slice(0, LABEL_MAX - 1).join('')}…`
}

function own(raw: RecordValue, key: string): unknown {
  return Object.hasOwn(raw, key) ? raw[key] : undefined
}

/** Ids from one instance. Missing or odd fields become an empty selection. */
export function parseInstanceOptionIds(value: unknown): InstanceOptionIds {
  const raw = record(value)
  if (!raw) return { categoryId: null, vibeIds: [] }
  const listed: string[] = []
  const seen = new Set<string>()
  const vibeIds = own(raw, 'vibeIds')
  if (Array.isArray(vibeIds)) {
    const cap = Math.min(vibeIds.length, VIBE_SCAN_LIMIT)
    for (let index = 0; index < cap; index += 1) {
      const id = optionId(vibeIds[index])
      if (!id || seen.has(id)) continue
      seen.add(id)
      listed.push(id)
    }
  }
  const display = optionId(own(raw, 'displayVibeId'))
  const ordered: string[] = []
  if (display && seen.has(display)) ordered.push(display)
  for (const id of listed) {
    if (ordered.length >= INSTANCE_VIBE_LIMIT) break
    if (!ordered.includes(id)) ordered.push(id)
  }
  return { categoryId: optionId(own(raw, 'categoryId')), vibeIds: ordered }
}

function catalogRows(items: unknown[], labelKey: 'name' | 'title'): Map<string, string> {
  const labels = new Map<string, string>()
  const cap = Math.min(items.length, CATALOG_ROW_LIMIT)
  for (let index = 0; index < cap; index += 1) {
    const row = record(items[index])
    if (!row || !Object.hasOwn(row, 'id') || !Object.hasOwn(row, labelKey)) continue
    if (Object.hasOwn(row, 'deleted') && row.deleted === true) continue
    const id = optionId(row.id)
    const label = labelText(row[labelKey])
    if (!id || !label || labels.has(id)) continue
    labels.set(id, label)
  }
  return labels
}

/**
 * The options document, or null when it is not `{ categories, vibes }` arrays.
 * A row that is deleted or incomplete is skipped. `iconUrl` is ignored.
 */
export function parseInstanceOptionCatalog(value: unknown): InstanceOptionCatalog | null {
  const raw = record(value)
  const categories = raw ? own(raw, 'categories') : undefined
  const vibes = raw ? own(raw, 'vibes') : undefined
  if (!Array.isArray(categories) || !Array.isArray(vibes)) return null
  return {
    categories: catalogRows(categories, 'name'),
    vibes: catalogRows(vibes, 'title')
  }
}

/** Names for the renderer. Unknown ids and a missing catalog contribute nothing. */
export function mapInstanceOptionLabels(
  ids: InstanceOptionIds,
  catalog: InstanceOptionCatalog | null
): InstanceOptionLabels {
  if (!catalog) return { category: null, vibes: [] }
  return {
    category: ids.categoryId ? (catalog.categories.get(ids.categoryId) ?? null) : null,
    vibes: ids.vibeIds.flatMap((id) => {
      const title = catalog.vibes.get(id)
      return title ? [title] : []
    })
  }
}
