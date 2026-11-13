// A fake VRChat and ChilloutVR for the end-to-end tests: plain HTTP and
// WebSocket on 127.0.0.1, sample accounts and friends that exist nowhere else.
// e2e/redirect.cjs sends the app's platform requests here.
//
// The replies follow the shapes VRX's own parsers expect (see the parsers in
// src/main/services/adapters and docs/api-volatility.md). When a parser
// changes shape, change the matching reply here in the same PR.
//
// Sign-in for a test: VRChat `tester` / `password`, ChilloutVR
// `tester@example.com` / `password`. Any name matching `tester<digits>` gets
// its own separate state, so tests never share data.
import http from 'node:http'
import { WebSocketServer } from 'ws'
import { handle as extraRoutes } from './fake-data.mjs'

/** Everything the fake did, newest last. `startFakePlatforms().log` reads it. */
const logLines = []
const log = (...a) => {
  logLines.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '))
  if (logLines.length > 4000) logLines.splice(0, 1000)
}

const uid = (n) => `usr_00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const gid = (n) => `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`
const WORLD = 'wrld_11111111-1111-4111-8111-111111111111'
const CVR_WORLD = '22222222-2222-4222-8222-222222222222'
const CVR_INSTANCE = 'i+0123456789abcdef-012345-abcdef-01234567'

function freshState() {
  return {
    mode: {
      blockRead: 'ok', // ok | filtered-403 | 401 | 403 | 500 | slow | non-array
      vrcWrite: 'ok', // ok | 401 | 403 | 400 | 500 | 429
      cvrUserBlockedField: 'present', // present | missing
      cvrSocketSilent: false
    },
    vrc: {
      me: { id: uid(1), displayName: 'Tester VRC' },
      friends: [
        {
          id: uid(101),
          displayName: 'Aria Vale',
          state: 'online',
          location: `${WORLD}:12345~region(us)`,
          status: 'join me',
          statusDescription: 'come hang out'
        },
        {
          id: uid(102),
          displayName: 'Brick Lane',
          state: 'active',
          location: 'offline',
          status: 'active',
          statusDescription: ''
        },
        {
          id: uid(103),
          displayName: 'Cass Nova',
          state: 'offline',
          location: 'offline',
          status: 'offline',
          statusDescription: ''
        },
        {
          id: uid(104),
          displayName: 'Dex Both',
          state: 'online',
          location: 'private',
          status: 'ask me',
          statusDescription: 'linked on both'
        },
        {
          id: uid(105),
          displayName: 'Echo Hush',
          state: 'online',
          location: `${WORLD}:777~friends(${uid(105)})~region(eu)`,
          status: 'busy',
          statusDescription: ''
        }
      ],
      strangers: [{ id: uid(201), displayName: 'Fen Stranger' }],
      // Each { id, type, targetUserId, targetDisplayName }
      moderations: [
        { id: 'pmod_1', type: 'block', targetUserId: uid(105) },
        { id: 'pmod_2', type: 'mute', targetUserId: uid(101) }
      ],
      notifications: []
    },
    cvr: {
      me: { userId: gid(1), username: 'TesterCVR' },
      friends: [
        { id: gid(101), name: 'Gale Wind', online: true },
        { id: gid(102), name: 'Dex Both CVR', online: true },
        { id: gid(103), name: 'Hollow Pine', online: false }
      ],
      strangers: [{ id: gid(201), name: 'Ivy Stranger' }],
      blocked: [gid(103)]
    },
    writes: [],
    requests: []
  }
}
const tenants = new Map()
function tenant(t) {
  if (!tenants.has(t))
    tenants.set(t, { S: freshState(), vrcSockets: new Set(), cvrSockets: new Set() })
  return tenants.get(t)
}
const cookieFor = (t) => `authcookie_fake_${t}`
const keyFor = (t) => `fakeaccesskey_${t}_0000000000000000`
function vrcTenantOf(req) {
  const m = (req.headers.cookie ?? '').match(/auth=authcookie_fake_([a-z0-9]+)/)
  return m ? m[1] : null
}
function cvrTenantOf(req) {
  const m = String(req.headers.accesskey ?? '').match(/^fakeaccesskey_([a-z0-9]+)_0+$/)
  return m ? m[1] : null
}

const json = (res, status, body, headers = {}) => {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers })
  res.end(text)
}

function vrcUser(S, f, full = false) {
  const base = {
    id: f.id,
    displayName: f.displayName,
    userIcon: '',
    profilePicOverride: '',
    profilePicOverrideThumbnail: '',
    currentAvatarImageUrl: '',
    currentAvatarThumbnailImageUrl: '',
    iconUrl: '',
    status: f.status ?? 'offline',
    statusDescription: f.statusDescription ?? '',
    location: f.location ?? 'offline',
    platform: 'standalonewindows',
    last_platform: 'standalonewindows',
    tags: ['system_trust_basic', 'system_trust_known', 'system_trust_trusted'],
    developerType: 'none',
    isFriend: S.vrc.friends.some((x) => x.id === f.id),
    friendKey: 'x',
    last_login: '2026-11-10T00:00:00.000Z',
    bio: full ? `Bio of ${f.displayName}` : undefined,
    pronouns: full ? 'they/them' : undefined,
    badges: [],
    note: full ? (S.vrc.notes?.[f.id] ?? '') : undefined,
    state: f.state ?? 'offline'
  }
  return base
}

function currentUser(S) {
  const on = S.vrc.friends.filter((f) => f.state === 'online').map((f) => f.id)
  const act = S.vrc.friends.filter((f) => f.state === 'active').map((f) => f.id)
  const off = S.vrc.friends.filter((f) => f.state === 'offline').map((f) => f.id)
  return {
    ...vrcUser(S, { ...S.vrc.me, state: 'online', status: 'active' }, true),
    id: S.vrc.me.id,
    displayName: S.vrc.me.displayName,
    username: 'tester',
    friends: S.vrc.friends.map((f) => f.id),
    onlineFriends: on,
    activeFriends: act,
    offlineFriends: off,
    homeLocation: WORLD
  }
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => resolve(data))
  })
}

function vrcPipe(T, type, content) {
  const frame = JSON.stringify({ type, content: JSON.stringify(content) })
  for (const s of T.vrcSockets) s.send(frame)
  log('vrc pipeline ->', type, content)
}
function cvrPipe(T, ResponseType, Data, Message = '') {
  const frame = JSON.stringify({ ResponseType, Message, Data })
  for (const s of T.cvrSockets) s.send(frame)
  log('cvr ws ->', ResponseType, Data)
}
function cvrOnlineSet(S) {
  return S.cvr.friends
    .filter((f) => f.online)
    .map((f) => ({
      Id: f.id,
      IsOnline: true,
      IsConnected: true,
      Instance: f.id === gid(101) ? { Id: CVR_INSTANCE, Name: 'Fake Club (#1)', Privacy: 0 } : null
    }))
}

function writeFailure(S, res) {
  const m = S.mode.vrcWrite
  if (m === 'ok') return false
  const code = Number(m)
  json(
    res,
    code,
    { error: { message: `fake ${code}`, status_code: code } },
    code === 429 ? { 'Retry-After': '5' } : {}
  )
  return true
}

// The fuller sample data (worlds, favorites, avatars, groups, profiles) lives
// in fake-data.mjs. It answers first; what it leaves falls through to the
// plain routes below.
async function runExt(_t, ctx) {
  try {
    return (await extraRoutes(ctx)) === true
  } catch (e) {
    log('EXT ERROR', e.stack)
    return false
  }
}

async function vrchat(req, res, url) {
  const p = url.pathname.replace(/^\/api\/1/, '')
  const q = url.searchParams
  const m = req.method
  if (p === '/auth/user' && m === 'GET') {
    const authz = req.headers.authorization
    if (authz?.startsWith('Basic ')) {
      const [u, pw] = Buffer.from(authz.slice(6), 'base64')
        .toString()
        .split(':')
        .map(decodeURIComponent)
      const t = /^tester[0-9]*$/.test(u) ? u : null
      if (t === null || pw !== 'password')
        return json(res, 401, {
          error: { message: 'Invalid Username/Email or Password', status_code: 401 }
        })
      return json(res, 200, currentUser(tenant(t).S), {
        'Set-Cookie': [`auth=${cookieFor(t)}; Max-Age=604800; Path=/; HttpOnly`]
      })
    }
    const t0 = vrcTenantOf(req)
    if (t0 === null || tenant(t0).S.vrc.signedOut)
      return json(res, 401, { error: { message: 'Missing Credentials', status_code: 401 } })
    return json(res, 200, currentUser(tenant(t0).S))
  }
  const t = vrcTenantOf(req)
  if (t === null || tenant(t).S.vrc.signedOut)
    return json(res, 401, { error: { message: 'Missing Credentials', status_code: 401 } })
  const T = tenant(t)
  const S = T.S
  if (
    await runExt(t, {
      platform: 'vrchat',
      req,
      res,
      url,
      path: p,
      method: m,
      S,
      T,
      json,
      readBody,
      vrcPipe: (type, content) => vrcPipe(T, type, content),
      cvrPipe: (rt, data) => cvrPipe(T, rt, data),
      vrcUser: (f, full) => vrcUser(S, f, full),
      cvrUserFull: (f) => cvrUserFull(S, f),
      log
    })
  )
    return
  if (p === '/auth' && m === 'GET') return json(res, 200, { ok: true, token: cookieFor(t) })
  if (p === '/logout') return json(res, 200, { success: { message: 'Ok!', status_code: 200 } })
  if (p === '/auth/user/friends' && m === 'GET') {
    const offline = q.get('offline') === 'true'
    const n = Number(q.get('n') ?? 50)
    const offset = Number(q.get('offset') ?? 0)
    const list = S.vrc.friends.filter((f) =>
      offline ? f.state === 'offline' : f.state !== 'offline'
    )
    return json(
      res,
      200,
      list.slice(offset, offset + n).map((f) => vrcUser(S, f))
    )
  }
  let mm
  if ((mm = p.match(/^\/auth\/user\/friends\/(usr_[\w-]+)$/)) && m === 'DELETE') {
    S.writes.push({ platform: 'vrchat', kind: 'unfriend', id: mm[1] })
    if (writeFailure(S, res)) return
    const before = S.vrc.friends.length
    S.vrc.friends = S.vrc.friends.filter((f) => f.id !== mm[1])
    if (before === S.vrc.friends.length)
      return json(res, 400, { error: { message: "These users aren't friends", status_code: 400 } })
    json(res, 200, { success: { message: 'Friendship destroyed', status_code: 200 } })
    setTimeout(() => vrcPipe(T, 'friend-delete', { userId: mm[1] }), 400)
    return
  }
  if (p === '/auth/user/playermoderations' && m === 'GET') {
    const bm = S.mode.blockRead
    const filtered = q.has('targetUserId') || q.has('type')
    if (bm === '401')
      return json(res, 401, { error: { message: 'Missing Credentials', status_code: 401 } })
    if (bm === '403' || (bm === 'filtered-403' && filtered))
      return json(res, 403, {
        error: { message: "You can't view someone else's player moderations", status_code: 403 }
      })
    if (bm === '500') return json(res, 500, { error: { message: 'oops', status_code: 500 } })
    if (bm === 'non-array') return json(res, 200, { nope: true })
    if (bm === 'slow') await new Promise((r) => setTimeout(r, 8000))
    let list = S.vrc.moderations
    if (q.get('type')) list = list.filter((x) => x.type === q.get('type'))
    if (q.get('targetUserId')) list = list.filter((x) => x.targetUserId === q.get('targetUserId'))
    return json(
      res,
      200,
      list.map((x) => ({
        ...x,
        created: '2026-11-01T00:00:00.000Z',
        sourceUserId: S.vrc.me.id,
        sourceDisplayName: S.vrc.me.displayName,
        targetDisplayName: 'someone'
      }))
    )
  }
  if (p === '/auth/user/playermoderations' && m === 'POST') {
    const body = JSON.parse((await readBody(req)) || '{}')
    S.writes.push({ platform: 'vrchat', kind: 'block', body })
    if (writeFailure(S, res)) return
    if (
      body.type === 'block' &&
      !S.vrc.moderations.some((x) => x.type === 'block' && x.targetUserId === body.moderated)
    ) {
      S.vrc.moderations.push({
        id: `pmod_${Date.now()}`,
        type: 'block',
        targetUserId: body.moderated
      })
    }
    return json(res, 200, {
      id: 'pmod_new',
      type: body.type,
      targetUserId: body.moderated,
      sourceUserId: S.vrc.me.id,
      created: new Date().toISOString(),
      sourceDisplayName: 'x',
      targetDisplayName: 'y'
    })
  }
  if (p === '/auth/user/unplayermoderate' && m === 'PUT') {
    const body = JSON.parse((await readBody(req)) || '{}')
    S.writes.push({ platform: 'vrchat', kind: 'unblock', body })
    if (writeFailure(S, res)) return
    S.vrc.moderations = S.vrc.moderations.filter(
      (x) => !(x.type === body.type && x.targetUserId === body.moderated)
    )
    return json(res, 200, { success: { message: 'Unmoderated', status_code: 200 } })
  }
  if ((mm = p.match(/^\/users\/(usr_[\w-]+)$/)) && m === 'GET') {
    const f = [...S.vrc.friends, ...S.vrc.strangers, S.vrc.me].find((x) => x.id === mm[1])
    if (!f) return json(res, 404, { error: { message: 'User not found', status_code: 404 } })
    return json(res, 200, vrcUser(S, f, true))
  }
  if ((mm = p.match(/^\/users\/(usr_[\w-]+)\/groups$/))) return json(res, 200, [])
  if (p === '/users' && m === 'GET') {
    const s = (q.get('search') ?? '').toLowerCase()
    const all = [...S.vrc.friends, ...S.vrc.strangers].filter((f) =>
      f.displayName.toLowerCase().includes(s)
    )
    return json(
      res,
      200,
      all.map((f) => vrcUser(S, f))
    )
  }
  if ((mm = p.match(/^\/user\/(usr_[\w-]+)\/friendRequest$/))) {
    S.writes.push({ platform: 'vrchat', kind: 'friend-request', id: mm[1], method: m })
    return json(res, 200, { success: { message: 'ok', status_code: 200 } })
  }
  if ((mm = p.match(/^\/auth\/user\/notifications\/([\w-]+)\/(accept|hide)$/))) {
    S.writes.push({ platform: 'vrchat', kind: `notification-${mm[2]}`, id: mm[1] })
    const n = S.vrc.notifications.find((x) => x.id === mm[1])
    if (mm[2] === 'accept' && n) {
      const st = [...S.vrc.strangers]
      const who = st.find((x) => x.id === n.senderUserId) ?? {
        id: n.senderUserId,
        displayName: n.senderUsername
      }
      S.vrc.strangers = S.vrc.strangers.filter((x) => x.id !== who.id)
      S.vrc.friends.push({
        ...who,
        state: 'active',
        location: 'offline',
        status: 'active',
        statusDescription: ''
      })
      setTimeout(
        () =>
          vrcPipe(T, 'friend-add', {
            userId: who.id,
            user: { ...vrcUser(S, who), state: 'active' }
          }),
        300
      )
    }
    return json(res, 200, { id: mm[1], type: 'friendRequest', seen: true })
  }
  if ((mm = p.match(/^\/worlds\/(wrld_[\w-]+)$/))) {
    return json(res, 200, {
      id: mm[1],
      name: 'Fake World',
      authorName: 'Builder',
      imageUrl: '',
      thumbnailImageUrl: '',
      capacity: 32,
      recommendedCapacity: 16,
      occupants: 5,
      tags: ['system_approved'],
      releaseStatus: 'public',
      description: 'A fake world.'
    })
  }
  if (p.startsWith('/worlds')) return json(res, 200, [])
  if (p === '/visits') return json(res, 200, 12345)
  if (p === '/auth/user/favoritelimits')
    return json(res, 200, {
      defaultMaxFavoriteGroups: 4,
      defaultMaxFavoritesPerGroup: 150,
      maxFavoriteGroups: { avatar: 6, friend: 3, world: 4 },
      maxFavoritesPerGroup: { avatar: 50, friend: 150, world: 100 }
    })
  if (p.startsWith('/favorite/groups')) return json(res, 200, [])
  if (p.startsWith('/favorites')) return json(res, 200, [])
  if (p.startsWith('/avatars')) return json(res, 200, [])
  if (p.startsWith('/instances/'))
    return json(res, 404, { error: { message: 'not found', status_code: 404 } })
  if (p.startsWith('/groups/'))
    return json(res, 404, { error: { message: 'not found', status_code: 404 } })
  if ((mm = p.match(/^\/profile\/(usr_[\w-]+)/)))
    return json(res, 200, {
      id: mm[1],
      bio: 'my bio',
      pronouns: 'they/them',
      status: 'active',
      statusDescription: ''
    })
  if ((mm = p.match(/^\/users\/(usr_[\w-]+)\/avatar$/)))
    return json(res, 200, {
      id: 'avtr_00000000-0000-4000-8000-000000000001',
      name: 'Fake Avatar',
      authorName: 'Builder',
      imageUrl: '',
      thumbnailImageUrl: '',
      releaseStatus: 'private',
      tags: []
    })
  if (p === '/userNotes' && m === 'POST') {
    const body = JSON.parse((await readBody(req)) || '{}')
    S.writes.push({ platform: 'vrchat', kind: 'note', body })
    S.vrc.notes = { ...(S.vrc.notes ?? {}), [body.targetUserId]: body.note }
    return json(res, 200, {
      id: 'unt_1',
      targetUserId: body.targetUserId,
      note: body.note,
      userId: S.vrc.me.id,
      createdAt: new Date().toISOString()
    })
  }
  if (p.startsWith('/invite/myself')) {
    S.writes.push({ platform: 'vrchat', kind: 'self-invite', path: p })
    return json(res, 200, { id: 'not_x' })
  }
  log('VRC UNHANDLED', `[${t}]`, m, url.pathname + url.search)
  return json(res, 404, { error: { message: 'fake: unhandled', status_code: 404 } })
}

function cvrUserFull(S, f) {
  const isFriend = S.cvr.friends.some((x) => x.id === f.id)
  const data = {
    id: f.id,
    name: f.name,
    imageUrl: '',
    onlineState: !!f.online,
    isConnected: !!f.online,
    isFriend,
    note: S.cvr.notes?.[f.id] ?? '',
    instance: null,
    categories: [],
    rank: 'User',
    featuredBadge: { name: 'No badge featured', image: '', badgeLevel: 0 },
    featuredGroup: { name: 'No group featured', image: '' },
    avatar: { id: gid(900), name: 'Lop', imageUrl: '' }
  }
  if (S.mode.cvrUserBlockedField === 'present') data.isBlocked = S.cvr.blocked.includes(f.id)
  return data
}
async function cvr(req, res, url) {
  const host = req.headers.host
  let p = url.pathname
  const m = req.method
  const ct = cvrTenantOf(req)
  if (host.startsWith('api.chilloutvr.net')) {
    if (
      ct !== null &&
      (await runExt(ct, {
        platform: 'chilloutvr-discovery',
        req,
        res,
        url,
        path: p,
        method: m,
        S: tenant(ct).S,
        T: tenant(ct),
        json,
        readBody,
        log
      }))
    )
      return
    if (p === '/1/public/userstats')
      return json(res, 200, {
        message: null,
        data: { usersOnline: { overall: 4321, public: 1000, notConnected: 10, other: 3311 } }
      })
    if (p.startsWith('/2/worlds/list/'))
      return json(res, 200, { message: null, data: { entries: [], totalPages: 0 } })
    let mm
    if ((mm = p.match(/^\/1\/instances\/(.+)$/))) {
      return json(res, 200, {
        message: null,
        data: {
          id: decodeURIComponent(mm[1]),
          name: 'Fake Club (#1)',
          instanceSettingPrivacy: 'Public',
          privacy: 'Public',
          region: 'eu',
          currentPlayerCount: 3,
          maxPlayer: 30,
          world: { id: CVR_WORLD, name: 'Fake Club', imageUrl: '' },
          members: []
        }
      })
    }
    if ((mm = p.match(/^\/1\/worlds\/(.+)$/)))
      return json(res, 200, {
        message: null,
        data: {
          id: mm[1],
          name: 'Fake Club',
          imageUrl: '',
          description: '',
          tags: [],
          instances: []
        }
      })
    log('CVR-DISC UNHANDLED', `[${ct}]`, m, url.pathname)
    return json(res, 404, { message: 'nope', data: null })
  }
  p = p.replace(/^\/1/, '')
  if (p === '/users/auth' && m === 'POST') {
    const body = JSON.parse((await readBody(req)) || '{}')
    let t = null
    const em = String(body.Username ?? '').match(/^(tester[0-9]*)@example\.com$/)
    if (body.AuthType === 2 && em && body.Password === 'password') t = em[1]
    if (body.AuthType === 1) {
      const km = String(body.Password ?? '').match(/^fakeaccesskey_([a-z0-9]+)_0+$/)
      if (km) t = km[1]
    }
    if (t === null || tenant(t).S.cvr.signedOut)
      return json(res, 401, { message: 'Invalid credentials', data: null })
    const S = tenant(t).S
    return json(res, 200, {
      message: 'Successfully logged in',
      data: {
        username: `${S.cvr.me.username}_${t}`,
        accessKey: keyFor(t),
        userId: S.cvr.me.userId,
        currentAvatar: gid(900),
        currentHomeWorld: CVR_WORLD,
        videoUrlResolverExecutable: '',
        videoUrlResolverHashes: '',
        blockedUsers: S.cvr.blocked
      }
    })
  }
  if (ct === null || tenant(ct).S.cvr.signedOut)
    return json(res, 401, { message: 'Not authenticated', data: null })
  const S = tenant(ct).S
  const T = tenant(ct)
  if (
    await runExt(ct, {
      platform: 'chilloutvr',
      req,
      res,
      url,
      path: p,
      method: m,
      S,
      T,
      json,
      readBody,
      vrcPipe: (type, content) => vrcPipe(T, type, content),
      cvrPipe: (rt, data) => cvrPipe(T, rt, data),
      vrcUser: (f, full) => vrcUser(S, f, full),
      cvrUserFull: (f) => cvrUserFull(S, f),
      log
    })
  )
    return
  if (p === '/friends')
    return json(res, 200, {
      message: null,
      data: S.cvr.friends.map((f) => ({ id: f.id, name: f.name, imageUrl: '', categories: [] }))
    })
  let mm
  if ((mm = p.match(/^\/users\/([0-9a-f-]{36})$/i)) && m === 'GET') {
    const id = mm[1].toLowerCase()
    const f = [...S.cvr.friends, ...S.cvr.strangers].find((x) => x.id === id)
    if (!f) return json(res, 404, { message: 'not found', data: null })
    return json(res, 200, { message: null, data: cvrUserFull(S, f) })
  }
  if ((mm = p.match(/^\/search\/(.+)$/))) {
    const s = decodeURIComponent(mm[1]).toLowerCase()
    const all = [...S.cvr.friends, ...S.cvr.strangers].filter((f) =>
      f.name.toLowerCase().includes(s)
    )
    return json(res, 200, {
      message: null,
      data: all.map((f) => ({ type: 'user', id: f.id, name: f.name, imageUrl: '' }))
    })
  }
  if (p === '/groups') return json(res, 200, { message: null, data: [] })
  if ((mm = p.match(/^\/instances\/(.+)$/))) {
    return json(res, 200, {
      message: null,
      data: {
        id: decodeURIComponent(mm[1]),
        name: 'Fake Club (#1)',
        instanceSettingPrivacy: 'Public',
        privacy: 'Public',
        region: 'eu',
        currentPlayerCount: 3,
        maxPlayer: 30,
        world: { id: CVR_WORLD, name: 'Fake Club', imageUrl: '' },
        members: []
      }
    })
  }
  if ((mm = p.match(/^\/users\/([0-9a-f-]{36})\/note$/i)) && m === 'POST') {
    const body = JSON.parse((await readBody(req)) || '{}')
    S.writes.push({ platform: 'chilloutvr', kind: 'note', id: mm[1], body })
    S.cvr.notes = { ...(S.cvr.notes ?? {}), [mm[1].toLowerCase()]: body.note ?? body.Note ?? '' }
    return json(res, 200, { message: 'ok', data: null })
  }
  if (p === '/categories')
    return json(res, 200, {
      message: null,
      data: { avatars: [], friends: [], worlds: [], spawnables: [] }
    })
  if (p.startsWith('/avatars') || p.startsWith('/users/avatars'))
    return json(res, 200, { message: null, data: [] })
  log('CVR UNHANDLED', `[${ct}]`, m, url.pathname + url.search)
  return json(res, 404, { message: 'fake: unhandled', data: null })
}

/**
 * Start the fake on a free local port.
 *
 * Returns the port, `state(name)` (the fake account's data, including `writes`:
 * every change VRX asked a platform to make), push helpers for live events,
 * the request log, and `close()`.
 */
export async function startFakePlatforms() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`)
    const rt = vrcTenantOf(req) ?? cvrTenantOf(req)
    if (rt) {
      const R = tenant(rt).S.requests
      R.push({
        at: Date.now(),
        host: req.headers.host,
        method: req.method,
        path: url.pathname + url.search
      })
      if (R.length > 2000) R.splice(0, 500)
    }
    log(req.method, req.headers.host, url.pathname + url.search)
    try {
      if (req.headers.host?.startsWith('api.vrchat.cloud')) return await vrchat(req, res, url)
      if (
        req.headers.host?.startsWith('api.abinteractive.net') ||
        req.headers.host?.startsWith('api.chilloutvr.net')
      )
        return await cvr(req, res, url)
      // Picture hosts: no picture. VRX shows its neutral fallback.
      res.writeHead(404)
      res.end()
    } catch (e) {
      log('ERROR', e.stack)
      json(res, 500, { error: String(e) })
    }
  })
  const wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (req, socket, head) => {
    const host = req.headers.host ?? ''
    log('UPGRADE', host, req.url)
    if (host.startsWith('pipeline.vrchat.cloud')) {
      const u = new URL(req.url, 'https://x')
      const tm = String(u.searchParams.get('authToken') ?? '').match(
        /^authcookie_fake_([a-z0-9]+)$/
      )
      if (!tm || tenant(tm[1]).S.vrc.signedOut) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        return socket.destroy()
      }
      const T = tenant(tm[1])
      wss.handleUpgrade(req, socket, head, (ws) => {
        T.vrcSockets.add(ws)
        ws.on('close', () => T.vrcSockets.delete(ws))
        ws.on('message', (d) => log('vrc pipeline <-', String(d)))
      })
      return
    }
    if (host.startsWith('api.chilloutvr.net')) {
      const ct = cvrTenantOf(req)
      if (ct === null || tenant(ct).S.cvr.signedOut) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        return socket.destroy()
      }
      const T = tenant(ct)
      const S = T.S
      wss.handleUpgrade(req, socket, head, (ws) => {
        T.cvrSockets.add(ws)
        ws.on('close', () => T.cvrSockets.delete(ws))
        ws.on('message', (d) => {
          log('cvr ws <-', String(d))
          let msg
          try {
            msg = JSON.parse(String(d))
          } catch {
            return
          }
          const id = msg?.Data?.id
          S.writes.push({ platform: 'chilloutvr', kind: `ws-${msg.RequestType}`, id })
          if (S.mode.cvrSocketSilent) return
          if (msg.RequestType === 8) {
            S.cvr.friends = S.cvr.friends.filter((f) => f.id !== id)
            setTimeout(() => cvrPipe(T, 11, null), 300)
          } else if (msg.RequestType === 30) {
            if (!S.cvr.blocked.includes(id)) S.cvr.blocked.push(id)
          } else if (msg.RequestType === 31) {
            S.cvr.blocked = S.cvr.blocked.filter((x) => x !== id)
          } else if (msg.RequestType === 6) {
            const who = S.cvr.strangers.find((x) => x.id === id)
            if (who) {
              S.cvr.strangers = S.cvr.strangers.filter((x) => x.id !== id)
              S.cvr.friends.push({ ...who, online: false })
              setTimeout(() => cvrPipe(T, 11, null), 300)
            }
          }
        })
        setTimeout(() => cvrPipe(T, 10, cvrOnlineSet(S)), 200)
      })
      return
    }
    socket.destroy()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    port: server.address().port,
    /** The data behind one test account (default `tester`). */
    state: (name = 'tester') => tenant(name).S,
    /** Push a VRChat live event, as its Pipeline would. */
    vrcEvent: (type, content, name = 'tester') => vrcPipe(tenant(name), type, content),
    /** Push a ChilloutVR socket frame, as `/users/ws` would. */
    cvrEvent: (responseType, data, name = 'tester') => cvrPipe(tenant(name), responseType, data),
    /** Change one VRChat friend and push the matching live event. */
    setVrcFriend(change, name = 'tester') {
      const T = tenant(name)
      const S = T.S
      const f = S.vrc.friends.find((x) => x.id === change.id)
      if (!f) throw new Error(`fake: no VRChat friend ${change.id}`)
      Object.assign(f, change)
      const type =
        change.state === 'offline'
          ? 'friend-offline'
          : change.state === 'active'
            ? 'friend-active'
            : change.location !== undefined
              ? 'friend-location'
              : 'friend-online'
      const content =
        type === 'friend-offline'
          ? { userId: f.id }
          : {
              userId: f.id,
              location: f.location,
              worldId: f.location.split(':')[0],
              travelingToLocation: '',
              user: vrcUser(S, f),
              platform: 'standalonewindows'
            }
      vrcPipe(T, type, content)
    },
    /** How many live sockets VRX holds open right now. */
    sockets: (name = 'tester') => ({
      vrchat: tenant(name).vrcSockets.size,
      chilloutvr: tenant(name).cvrSockets.size
    }),
    log: () => [...logLines],
    async close() {
      for (const T of tenants.values()) {
        for (const s of [...T.vrcSockets, ...T.cvrSockets]) s.terminate()
      }
      tenants.clear()
      wss.close()
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    }
  }
}
