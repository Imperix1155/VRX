// Fuller sample data for the fake platforms: worlds, favorites in two groups
// per platform, avatars, groups, profiles and a home world. The shapes follow
// VRX's parsers (GameFavoritesAdapter.ts, vrchat/*.ts, cvr/*.ts) and
// docs/api-volatility.md.
//
// `handle(ctx)` answers a request and returns true, or returns nothing so the
// plain routes in fake-platforms.mjs answer it.
const W1 = 'wrld_11111111-1111-4111-8111-111111111111' // Aria's world
const W2 = 'wrld_33333333-3333-4333-8333-333333333333'
const W3 = 'wrld_44444444-4444-4444-8444-444444444444'
const CW1 = '22222222-2222-4222-8222-222222222222'
const CW2 = '55555555-5555-4555-8555-555555555555'
const CINST = 'i+0123456789abcdef-012345-abcdef-01234567'
const uid = (n) => `usr_00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const gid = (n) => `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`
const fvrt = (n) => `fvrt_00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const vrcWorlds = {
  [W1]: { name: 'Fake World', occupants: 5 },
  [W2]: { name: 'Sunset Lounge', occupants: 12 },
  [W3]: { name: 'Quiet Library', occupants: 3 }
}
const cvrWorlds = {
  [CW1]: { name: 'Fake Club' },
  [CW2]: { name: 'Neon Arcade' }
}

/** What a VRChat room may say about itself. The Explore sheet shows all three. */
const ROOM_DETAILS = {
  displayName: 'Friday Hangout',
  description: 'Everyone is welcome.',
  dominantLanguage: 'pt-BR'
}

function st(S) {
  if (!S.t5) {
    S.t5 = {
      vrcFavs: [
        { id: fvrt(1), type: 'friend', favoriteId: uid(102), tags: ['group_0'] },
        { id: fvrt(3), type: 'friend', favoriteId: uid(101), tags: ['group_1'] },
        { id: fvrt(4), type: 'friend', favoriteId: uid(103), tags: ['group_0'] },
        { id: fvrt(2), type: 'world', favoriteId: W2, tags: ['worlds1'] }
      ],
      vrcProfile: {
        bio: 'my bio',
        pronouns: 'they/them',
        status: 'active',
        statusDescription: 'testing'
      },
      vrcAvatar: 'avtr_00000000-0000-4000-8000-000000000001',
      cvrCats: {
        [gid(101)]: ['friends_besties'],
        [gid(102)]: ['friends_work'],
        [gid(103)]: [],
        [CW1]: [],
        [CW2]: ['worlds_chill']
      },
      cvrProfile: { profileBio: 'cvr bio', profilePronouns: 'she/her' },
      cvrAvatar: gid(900),
      n: 10
    }
  }
  return S.t5
}

function vrcWorld(id, extra = {}) {
  const w = vrcWorlds[id] ?? { name: 'Unknown', occupants: 0 }
  return {
    id,
    name: w.name,
    authorName: 'Builder',
    authorId: uid(900),
    imageUrl: '',
    thumbnailImageUrl: '',
    capacity: 32,
    recommendedCapacity: 16,
    occupants: w.occupants,
    popularity: 5,
    tags: ['system_approved', 'author_tag_chill', 'author_tag_music', 'author_tag_late_night'],
    releaseStatus: 'public',
    description: `About ${w.name}. A cozy place to sit, talk and listen to music with friends.`,
    ...extra
  }
}

function vrcAvatar(n, name, extra = {}) {
  return {
    id: `avtr_00000000-0000-4000-8000-00000000000${n}`,
    name,
    description: `${name} desc`,
    authorName: 'Tester VRC',
    authorId: uid(1),
    imageUrl: '',
    thumbnailImageUrl: '',
    releaseStatus: n === 2 ? 'public' : 'private',
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-11-01T00:00:00.000Z',
    tags: [],
    ...extra
  }
}
const VRC_AVATARS = [
  vrcAvatar(1, 'Fox Default'),
  vrcAvatar(2, 'Robot Suit'),
  vrcAvatar(3, 'Cat Casual')
]

export async function handle(ctx) {
  const { platform, req, res, url, path: p, method: m, S, json, readBody } = ctx
  const s = st(S)
  const q = url.searchParams
  let mm
  if (platform === 'vrchat') {
    const me = S.vrc.me.id
    if (p === '/userNotes' && m === 'POST' && S.vrc.noteFail) {
      const body = JSON.parse((await readBody(req)) || '{}')
      S.writes.push({ platform: 'vrchat', kind: 'note-failed', body })
      return (
        json(res, S.vrc.noteFail, { error: { message: 'fake fail', status_code: S.vrc.noteFail } }),
        true
      )
    }
    // Explore / search worlds
    if (p === '/worlds/active')
      return (json(res, 200, [vrcWorld(W1), vrcWorld(W2), vrcWorld(W3)]), true)
    if (p === '/worlds/favorites') {
      const list = s.vrcFavs
        .filter((f) => f.type === 'world')
        .map((f) => ({ ...vrcWorld(f.favoriteId), favoriteGroup: f.tags[0], favoriteId: f.id }))
      return (json(res, 200, list), true)
    }
    if (p === '/worlds' && m === 'GET') {
      const search = (q.get('search') ?? '').toLowerCase()
      let list = Object.keys(vrcWorlds).map((id) => vrcWorld(id))
      if (search) list = list.filter((w) => w.name.toLowerCase().includes(search))
      if (q.get('userId')) list = []
      return (json(res, 200, list), true)
    }
    // The signed-in user's own rating of a world: read, set, clear.
    if ((mm = p.match(/^\/worlds\/(wrld_[\w-]+)\/rating$/))) {
      s.vrcRatings ??= {}
      const id = mm[1]
      // A test makes the next read fail with `state().mode.vrcRatingReadFails = 1`.
      if (m === 'GET' && (S.mode.vrcRatingReadFails ?? 0) > 0) {
        S.mode.vrcRatingReadFails -= 1
        return (json(res, 500, { error: { message: 'fake fail', status_code: 500 } }), true)
      }
      if (m === 'PUT') {
        const body = JSON.parse((await readBody(req)) || '{}')
        S.writes.push({ platform: 'vrchat', kind: 'world-rating', id, value: body.value })
        s.vrcRatings[id] = body.value
      } else if (m === 'DELETE') {
        S.writes.push({ platform: 'vrchat', kind: 'world-rating-clear', id })
        delete s.vrcRatings[id]
      }
      return (json(res, 200, { value: s.vrcRatings[id] ?? null }), true)
    }
    if ((mm = p.match(/^\/worlds\/(wrld_[\w-]+)$/)) && m === 'GET') {
      const id = mm[1]
      const inst =
        id === W1 ? [['12345~region(us)', 5, {}]] : id === W2 ? [['555~region(eu)', 12, {}]] : []
      return (json(res, 200, vrcWorld(id, { instances: inst })), true)
    }
    if ((mm = p.match(/^\/worlds\/(wrld_[\w-]+)\/(.+)$/)) && m === 'GET') {
      const [, wid, iid] = mm
      return (
        json(res, 200, {
          id: `${wid}:${iid}`,
          location: `${wid}:${iid}`,
          worldId: wid,
          instanceId: iid,
          type: 'public',
          n_users: 5,
          userCount: 5,
          capacity: 32,
          region: 'us',
          active: true,
          full: false,
          hasCapacityForYou: true,
          roleRestricted: false,
          ageGate: false,
          closedAt: null,
          hardClose: null,
          groupAccessType: null,
          ...ROOM_DETAILS
        }),
        true
      )
    }
    if ((mm = p.match(/^\/instances\/(wrld_[\w-]+):(.+)$/)) && m === 'GET') {
      const [, wid, iid] = mm
      return (
        json(res, 200, {
          id: `${wid}:${iid}`,
          location: `${wid}:${iid}`,
          worldId: wid,
          instanceId: decodeURIComponent(iid),
          type: 'public',
          n_users: 5,
          userCount: 5,
          capacity: 32,
          region: 'us',
          active: true,
          full: false,
          hasCapacityForYou: true,
          roleRestricted: false,
          ageGate: false,
          closedAt: null,
          hardClose: null,
          world: vrcWorld(wid)
        }),
        true
      )
    }
    // Favorites
    if (p === '/favorite/groups' || p.startsWith('/favorite/groups?')) {
      return (
        json(res, 200, [
          {
            id: 'fvgrp_00000000-0000-4000-8000-000000000001',
            ownerId: me,
            type: 'friend',
            name: 'group_0',
            displayName: 'Besties',
            visibility: 'private',
            tags: []
          },
          {
            id: 'fvgrp_00000000-0000-4000-8000-000000000002',
            ownerId: me,
            type: 'friend',
            name: 'group_1',
            displayName: 'Work',
            visibility: 'private',
            tags: []
          },
          {
            id: 'fvgrp_00000000-0000-4000-8000-000000000003',
            ownerId: me,
            type: 'world',
            name: 'worlds1',
            displayName: 'Chill spots',
            visibility: 'private',
            tags: []
          }
        ]),
        true
      )
    }
    if (p === '/favorites' && m === 'GET') {
      const type = q.get('type')
      return (
        json(
          res,
          200,
          s.vrcFavs.filter((f) => !type || f.type === type)
        ),
        true
      )
    }
    if (p === '/favorites' && m === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}')
      S.writes.push({ platform: 'vrchat', kind: 'favorite-add', body })
      const rec = { id: fvrt(++s.n), type: body.type, favoriteId: body.favoriteId, tags: body.tags }
      s.vrcFavs.push(rec)
      return (json(res, 200, rec), true)
    }
    if ((mm = p.match(/^\/favorites\/(.+)$/)) && m === 'DELETE') {
      const id = decodeURIComponent(mm[1])
      S.writes.push({ platform: 'vrchat', kind: 'favorite-remove', id })
      s.vrcFavs = s.vrcFavs.filter((f) => f.id !== id && f.favoriteId !== id)
      return (json(res, 200, { success: { message: 'ok', status_code: 200 } }), true)
    }
    // Avatars
    if (p === '/avatars' && m === 'GET')
      return (json(res, 200, Number(q.get('offset') ?? 0) > 0 ? [] : VRC_AVATARS), true)
    if ((mm = p.match(/^\/avatars\/(avtr_[\w-]+)\/select$/)) && m === 'PUT') {
      S.writes.push({ platform: 'vrchat', kind: 'avatar-select', id: mm[1] })
      s.vrcAvatar = mm[1]
      return (json(res, 200, { ...S.vrc.me, currentAvatar: mm[1] }), true)
    }
    if ((mm = p.match(/^\/avatars\/(avtr_[\w-]+)$/)) && m === 'GET') {
      const a = VRC_AVATARS.find((x) => x.id === mm[1])
      return a
        ? (json(res, 200, a), true)
        : (json(res, 404, { error: { message: 'nope', status_code: 404 } }), true)
    }
    if ((mm = p.match(/^\/users\/(usr_[\w-]+)\/avatar$/))) {
      if (mm[1] === me)
        return (
          json(res, 200, VRC_AVATARS.find((x) => x.id === s.vrcAvatar) ?? VRC_AVATARS[0]),
          true
        )
      return false
    }
    // Groups
    if ((mm = p.match(/^\/users\/(usr_[\w-]+)\/groups$/)) && mm[1] === me) {
      return (
        json(res, 200, [
          {
            id: 'gmem_00000000-0000-4000-8000-000000000001',
            groupId: 'grp_00000000-0000-4000-8000-000000000001',
            name: 'Fake Builders',
            shortCode: 'FAKEB',
            discriminator: '0001',
            description: 'People who build fake worlds',
            iconUrl: '',
            bannerUrl: '',
            memberCount: 42,
            ownerId: me
          },
          {
            id: 'gmem_00000000-0000-4000-8000-000000000002',
            groupId: 'grp_00000000-0000-4000-8000-000000000002',
            name: 'Night Owls',
            shortCode: 'OWLS',
            discriminator: '1234',
            description: 'Late hangouts',
            iconUrl: '',
            bannerUrl: '',
            memberCount: 7,
            ownerId: uid(101)
          }
        ]),
        true
      )
    }
    // Own profile
    if ((mm = p.match(/^\/profile\/(usr_[\w-]+)$/))) {
      if (m === 'GET') return (json(res, 200, { id: mm[1], ...s.vrcProfile }), true)
      if (m === 'PUT') {
        const body = JSON.parse((await readBody(req)) || '{}')
        S.writes.push({ platform: 'vrchat', kind: 'profile-put', body })
        Object.assign(s.vrcProfile, body)
        return (json(res, 200, { id: mm[1], ...s.vrcProfile }), true)
      }
    }
    if ((mm = p.match(/^\/users\/(usr_[\w-]+)$/)) && m === 'PUT') {
      const body = JSON.parse((await readBody(req)) || '{}')
      S.writes.push({ platform: 'vrchat', kind: 'user-put', id: mm[1], body })
      for (const k of ['pronouns', 'status', 'statusDescription'])
        if (k in body) s.vrcProfile[k] = body[k]
      if (body.homeLocation) s.vrcHome = body.homeLocation
      return (json(res, 200, { ...ctx.vrcUser(S.vrc.me, true), ...body }), true)
    }
    if ((mm = p.match(/^\/users\/(usr_[\w-]+)$/)) && m === 'GET' && mm[1] === me) {
      return (
        json(res, 200, { ...ctx.vrcUser(S.vrc.me, true), ...s.vrcProfile, note: undefined }),
        true
      )
    }
    return false
  }

  if (platform === 'chilloutvr-discovery') {
    const entry = (id) => ({ id, name: cvrWorlds[id].name, imageUrl: '', playerCount: 3 })
    if ((mm = p.match(/^\/2\/worlds\/list\/([\w-]+)$/))) {
      const cat = mm[1]
      if (cat === 'wrldactive' || cat === 'wrldnew' || cat === 'wrldrecentlyupdated')
        return (
          json(res, 200, {
            message: null,
            data: { totalPages: 1, entries: [entry(CW1), entry(CW2)] }
          }),
          true
        )
      const list = Object.keys(cvrWorlds).filter((id) => (s.cvrCats[id] ?? []).includes(cat))
      return (
        json(res, 200, { message: null, data: { totalPages: 1, entries: list.map(entry) } }),
        true
      )
    }
    if ((mm = p.match(/^\/1\/worlds\/([0-9a-f-]{36})$/i))) {
      const id = mm[1].toLowerCase()
      const w = cvrWorlds[id] ?? { name: 'Unknown' }
      return (
        json(res, 200, {
          message: null,
          data: {
            id,
            name: w.name,
            imageUrl: '',
            description: `About ${w.name}. A cozy place to sit, talk and listen to music with friends.`,
            tags: ['chill', 'music', 'late night'],
            categories: s.cvrCats[id] ?? [],
            author: { id: gid(900), name: 'Builder', imageUrl: '' },
            instances: id === CW1 ? [{ id: CINST, name: 'Fake Club (#1)' }] : []
          }
        }),
        true
      )
    }
    return false
  }

  if (platform === 'chilloutvr') {
    const me = S.cvr.me.userId
    if ((mm = p.match(/^\/users\/([0-9a-f-]{36})\/note$/i)) && m === 'POST' && S.cvr.noteFail) {
      const body = JSON.parse((await readBody(req)) || '{}')
      S.writes.push({ platform: 'chilloutvr', kind: 'note-failed', id: mm[1], body })
      return (json(res, S.cvr.noteFail, { message: 'fake fail', data: null }), true)
    }
    if (p === '/categories' && m === 'GET') {
      return (
        json(res, 200, {
          message: null,
          data: {
            avatars: [],
            spawnables: [],
            friends: [
              { id: 'frndonline', name: 'Online' },
              { id: 'friends_besties', name: 'Besties' },
              { id: 'friends_work', name: 'Work' }
            ],
            worlds: [
              { id: 'wrldactive', name: 'Active' },
              { id: 'worlds_chill', name: 'Chill' }
            ]
          }
        }),
        true
      )
    }
    if (p === '/categories/assign' && m === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}')
      S.writes.push({ platform: 'chilloutvr', kind: 'categories-assign', body })
      s.cvrCats[String(body.Uuid).toLowerCase()] = body.Categories
      return (json(res, 200, { message: 'ok', data: null }), true)
    }
    if (p === '/friends') {
      return (
        json(res, 200, {
          message: null,
          data: S.cvr.friends.map((f) => ({
            id: f.id,
            name: f.name,
            imageUrl: '',
            categories: s.cvrCats[f.id] ?? []
          }))
        }),
        true
      )
    }
    if ((mm = p.match(/^\/users\/([0-9a-f-]{36})$/i)) && m === 'GET') {
      const id = mm[1].toLowerCase()
      if (id === me) {
        return (
          json(res, 200, {
            message: null,
            data: {
              id: me,
              name: 'TesterCVR',
              imageUrl: '',
              ...s.cvrProfile,
              rank: 'User',
              onlineState: true,
              isFriend: false,
              categories: [],
              avatar: { id: s.cvrAvatar, name: 'Lop', imageUrl: '' },
              featuredBadge: { name: 'No badge featured', image: '', badgeLevel: 0 }
            }
          }),
          true
        )
      }
      const f = [...S.cvr.friends, ...S.cvr.strangers].find((x) => x.id === id)
      if (!f) return false
      return (
        json(res, 200, {
          message: null,
          data: {
            ...ctx.cvrUserFull(f),
            categories: s.cvrCats[id] ?? [],
            profileBio: `Bio of ${f.name}`,
            profilePronouns: 'they/them'
          }
        }),
        true
      )
    }
    if (p === '/users/self' && m === 'POST') {
      const raw = await readBody(req)
      S.writes.push({
        platform: 'chilloutvr',
        kind: 'profile-self',
        ctype: req.headers['content-type'],
        raw: raw.slice(0, 600)
      })
      const b = raw.match(/name="ProfileBio"\r?\n\r?\n([\s\S]*?)\r?\n--/)
      const pr = raw.match(/name="ProfilePronouns"\r?\n\r?\n([\s\S]*?)\r?\n--/)
      if (b) s.cvrProfile.profileBio = b[1]
      if (pr) s.cvrProfile.profilePronouns = pr[1]
      return (json(res, 200, { message: 'Profile updated', data: null }), true)
    }
    if ((mm = p.match(/^\/search\/(.+)$/))) {
      const term = decodeURIComponent(mm[1]).toLowerCase()
      const people = [...S.cvr.friends, ...S.cvr.strangers]
        .filter((f) => f.name.toLowerCase().includes(term))
        .map((f) => ({ type: 'user', id: f.id, name: f.name, imageUrl: '' }))
      const worlds = Object.keys(cvrWorlds)
        .filter((id) => cvrWorlds[id].name.toLowerCase().includes(term))
        .map((id) => ({ type: 'world', id, name: cvrWorlds[id].name, imageUrl: '' }))
      return (json(res, 200, { message: null, data: [...people, ...worlds] }), true)
    }
    if (p === '/groups' && m === 'GET') {
      return (
        json(res, 200, {
          message: null,
          data: {
            owned: [
              {
                id: '66666666-6666-4666-8666-666666666666',
                tag: 'CLUB',
                name: 'Club Owners',
                description: 'We run the club',
                memberCount: 12,
                image: '',
                banner: ''
              }
            ],
            member: [
              {
                id: '77777777-7777-4777-8777-777777777777',
                tag: 'ARC',
                name: 'Arcade Fans',
                description: 'Neon lovers',
                memberCount: 300,
                image: '',
                banner: ''
              }
            ]
          }
        }),
        true
      )
    }
    if (p === '/avatars' && m === 'GET') {
      return (
        json(res, 200, {
          message: null,
          data: [
            {
              id: gid(900),
              name: 'Lop',
              imageUrl: '',
              authorGuid: me,
              categories: ['avtrmine'],
              description: 'default'
            },
            {
              id: gid(901),
              name: 'Kitsune',
              imageUrl: '',
              authorGuid: me,
              categories: ['avtrmine'],
              description: 'fox'
            },
            {
              id: gid(902),
              name: 'Shared Bot',
              imageUrl: '',
              authorGuid: gid(500),
              categories: ['avtrshared'],
              description: 'not mine'
            }
          ]
        }),
        true
      )
    }
    if ((mm = p.match(/^\/avatars\/([0-9a-f-]{36})\/switchAvatar$/i))) {
      S.writes.push({ platform: 'chilloutvr', kind: 'avatar-switch', id: mm[1], method: m })
      s.cvrAvatar = mm[1].toLowerCase()
      return (json(res, 200, { message: 'Avatar switched', data: null }), true)
    }
    if ((mm = p.match(/^\/avatars\/([0-9a-f-]{36})$/i))) {
      const id = mm[1].toLowerCase()
      const names = { [gid(900)]: 'Lop', [gid(901)]: 'Kitsune' }
      if (!names[id]) return false
      return (
        json(res, 200, {
          message: null,
          data: {
            id,
            name: names[id],
            description: '',
            imageUrl: '',
            author: { id: me, name: 'TesterCVR' },
            isPublished: id === gid(901),
            uploadedAt: '2026-09-01T00:00:00Z',
            updatedAt: '2026-10-01T00:00:00Z'
          }
        }),
        true
      )
    }
    if ((mm = p.match(/^\/worlds\/([0-9a-f-]{36})\/sethome$/i))) {
      S.writes.push({ platform: 'chilloutvr', kind: 'sethome', id: mm[1], method: m })
      return (json(res, 200, { message: 'Home world set', data: null }), true)
    }
    if ((mm = p.match(/^\/users\/([0-9a-f-]{36})\/worlds$/i)))
      return (json(res, 200, { message: null, data: [] }), true)
    if ((mm = p.match(/^\/users\/([0-9a-f-]{36})\/groups$/i)))
      return (json(res, 200, { message: null, data: { owned: [], member: [] } }), true)
    return false
  }
  return false
}
