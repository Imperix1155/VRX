import { describe, expect, it } from 'vitest'
import {
  INSTANCE_VIBE_LIMIT,
  mapInstanceOptionLabels,
  parseInstanceOptionCatalog,
  parseInstanceOptionIds
} from './instanceOptions'

/** Example ids and required fields from the community spec at `bfafa918`. */
const HANGOUT = 'icat_44bc6a70-493f-4f84-8a3b-1f290c864c2a'
const ADVENTURE = 'ivib_2d8445c4-f47b-4635-b565-467fc32c4003'
const COZY = 'ivib_11111111-1111-1111-1111-111111111111'
const DELETED_VIBE = 'ivib_22222222-2222-2222-2222-222222222222'
const GAMES = 'icat_33333333-3333-3333-3333-333333333333'

const specOptions = {
  categories: [
    {
      deleted: false,
      iconUrl: 'vrchat://category_hangout',
      id: HANGOUT,
      name: 'Hangout',
      order: 0
    },
    {
      deleted: false,
      iconUrl: 'vrchat://category_games',
      id: GAMES,
      name: 'Games',
      order: 2
    },
    {
      deleted: true,
      iconUrl: 'vrchat://category_other',
      id: 'icat_deleted',
      name: 'Other',
      order: 7
    }
  ],
  vibes: [
    { deleted: false, id: COZY, title: 'cozy' },
    { deleted: false, id: ADVENTURE, title: '  adventure \n' },
    { deleted: true, id: DELETED_VIBE, title: 'gone' }
  ]
}

describe('parseInstanceOptionCatalog', () => {
  it('reads category names and vibe titles from the spec document', () => {
    const catalog = parseInstanceOptionCatalog(specOptions)
    expect(catalog?.categories.get(HANGOUT)).toBe('Hangout')
    expect(catalog?.categories.get(GAMES)).toBe('Games')
    expect(catalog?.categories.has('icat_deleted')).toBe(false)
    expect(catalog?.vibes.get(ADVENTURE)).toBe('adventure')
    expect(catalog?.vibes.get(COZY)).toBe('cozy')
    expect(catalog?.vibes.has(DELETED_VIBE)).toBe(false)
    expect(
      JSON.stringify([...catalog!.categories.values(), ...catalog!.vibes.values()])
    ).not.toContain('vrchat://')
  })

  it('returns null unless both lists are arrays, and skips a bad row', () => {
    expect(parseInstanceOptionCatalog(null)).toBeNull()
    expect(parseInstanceOptionCatalog({ categories: [], vibes: null })).toBeNull()
    expect(parseInstanceOptionCatalog({ vibes: [] })).toBeNull()
    const inherited = Object.assign(Object.create({ categories: [], vibes: [] }), {})
    expect(parseInstanceOptionCatalog(inherited)).toBeNull()

    const catalog = parseInstanceOptionCatalog({
      categories: [
        { id: HANGOUT, name: 'Hangout', deleted: false },
        { id: 'icat_noname', deleted: false },
        { name: 'No id', deleted: false },
        { id: 'icat_blank', name: '   ', deleted: false },
        'nope'
      ],
      vibes: []
    })
    expect([...(catalog?.categories.keys() ?? [])]).toEqual([HANGOUT])
  })
})

describe('parseInstanceOptionIds', () => {
  it('keeps a category and at most three vibes, with the display vibe first', () => {
    expect(
      parseInstanceOptionIds({
        categoryId: HANGOUT,
        displayVibeId: ADVENTURE,
        vibeIds: [COZY, ADVENTURE, 'ivib_third', 'ivib_fourth', COZY]
      })
    ).toEqual({
      categoryId: HANGOUT,
      vibeIds: [ADVENTURE, COZY, 'ivib_third']
    })
    expect(INSTANCE_VIBE_LIMIT).toBe(3)
  })

  it('drops a display vibe that is not in vibeIds, and ignores odd or inherited fields', () => {
    expect(
      parseInstanceOptionIds({
        categoryId: null,
        displayVibeId: ADVENTURE,
        vibeIds: [COZY, 4, '', 'ivib_ok']
      })
    ).toEqual({ categoryId: null, vibeIds: [COZY, 'ivib_ok'] })

    const inherited = Object.assign(
      Object.create({
        categoryId: HANGOUT,
        displayVibeId: ADVENTURE,
        vibeIds: [COZY]
      }),
      {}
    )
    expect(parseInstanceOptionIds(inherited)).toEqual({ categoryId: null, vibeIds: [] })
    expect(
      parseInstanceOptionIds({
        categoryId: { id: HANGOUT },
        vibeIds: 'ivib_nope',
        displayVibeId: 3
      })
    ).toEqual({ categoryId: null, vibeIds: [] })
    expect(parseInstanceOptionIds(null)).toEqual({ categoryId: null, vibeIds: [] })
  })
})

describe('mapInstanceOptionLabels', () => {
  const catalog = parseInstanceOptionCatalog(specOptions)

  it('maps known ids and drops unknown, deleted, and a missing catalog', () => {
    const labels = mapInstanceOptionLabels(
      parseInstanceOptionIds({
        categoryId: HANGOUT,
        displayVibeId: ADVENTURE,
        vibeIds: [COZY, ADVENTURE, DELETED_VIBE, 'ivib_unknown']
      }),
      catalog
    )
    expect(labels).toEqual({ category: 'Hangout', vibes: ['adventure', 'cozy'] })
    const encoded = JSON.stringify(labels)
    expect(encoded).not.toContain('icat_')
    expect(encoded).not.toContain('ivib_')

    expect(
      mapInstanceOptionLabels({ categoryId: 'icat_missing', vibeIds: ['ivib_missing'] }, catalog)
    ).toEqual({ category: null, vibes: [] })
    expect(mapInstanceOptionLabels({ categoryId: HANGOUT, vibeIds: [ADVENTURE] }, null)).toEqual({
      category: null,
      vibes: []
    })
  })
})
