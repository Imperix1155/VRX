# API volatility

VRChat and ChilloutVR do not publish a supported API for third-party desktop
clients. VRX depends on unofficial REST endpoints, WebSocket messages, deep
links, image hosts and, for "Use my sign-in from this PC", local files.
Any of them can change without notice.

This file lists every platform surface VRX uses. For each one it records what
VRX assumes, how the code parses it defensively, what is uncertain or has
changed, and what VRX does when the assumption breaks. The adapter code is the
source of truth:

- VRChat: [`VrcApiClient.ts`](../src/main/services/adapters/VrcApiClient.ts),
  [`VrcAdapter.ts`](../src/main/services/adapters/VrcAdapter.ts) and
  [`vrchat/`](../src/main/services/adapters/vrchat/AGENTS.md).
- ChilloutVR: [`CvrApiClient.ts`](../src/main/services/adapters/CvrApiClient.ts),
  [`CvrAdapter.ts`](../src/main/services/adapters/CvrAdapter.ts),
  [`cvr/`](../src/main/services/adapters/cvr/AGENTS.md) and
  [`cvrSessionImport.ts`](../src/main/services/cvrSessionImport.ts).
- VRCX sign-in: [`vrcxSessionImport.ts`](../src/main/services/vrcxSessionImport.ts).

Request pacing, 429 cooldowns, retries, the User-Agent, Explore budgets and the
"no polling, no mass actions" rules live in [API policy](api-policy.md). This
file does not repeat them.

## Evidence labels

| Label          | Meaning                                                                                                                                                  |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live `<date>`  | Someone saw this shape in a real response, socket frame or local file on that date.                                                                      |
| Live           | Shipped builds use this surface against the real service. No single dated capture is recorded.                                                           |
| Documented     | The platform's own public documentation describes it.                                                                                                    |
| Source-derived | Taken from community specifications, open-source clients (vrchatapi, VRCX, CVRX, chilloutvr_rs) or the owner's earlier working app. Not captured by VRX. |
| Synthetic      | Only VRX tests with fixtures exercise the shape. Real-account compatibility is unverified.                                                               |

## Shared handling

Both adapters inherit these rules from
[`BaseAdapter.ts`](../src/main/services/adapters/BaseAdapter.ts),
[`ReconnectingPipeline.ts`](../src/main/services/adapters/ReconnectingPipeline.ts)
and [`avatarCache.ts`](../src/main/services/avatarCache.ts). Platform sections
only note where they differ.

**REST responses**

- Requests use `redirect: 'error'` and a 15 s timeout (`API_TIMEOUT_MS`). A
  redirect from a REST endpoint is a failed request.
- 401 and 403 become `AuthError` (`CVRAuthError` on ChilloutVR). Other non-2xx
  statuses, unreadable JSON and schema mismatches become `NetworkError`.
- A 429 sets the platform cooldown from `Retry-After` (seconds or an HTTP date)
  or a growing fallback. Roster pages and background metadata stop at once;
  other requests follow the bounded retry policy in [API policy](api-policy.md).
- Three consecutive failed typed requests open a per-adapter circuit for 60 s.
  Sign-in and re-auth read raw responses, so their HTTP statuses never count,
  and sign-in resets the circuit first. The VRChat status probe and Pipeline
  token exchange, ChilloutVR restore checks and ChilloutVR instance lookups do
  not count at all. VRChat world and group lookups count only 401 and 403
  answers; a missing, failing or unreadable item never opens the circuit.
  VRChat counts 403s; ChilloutVR does not, because it confirms 403s itself.
- Responses are validated with Zod. Lists are validated record by record: a
  malformed record is skipped and counted, and its valid siblings survive.
- A roster with any skipped record, failed page or cap hit is `partial`. A
  partial roster never removes cached friends or marks absent friends offline. A
  roster with nothing usable throws instead of returning an empty list.
- Cancellation, admission overflow and a not-yet-durable session
  (`AuthSessionPendingError`) propagate as control flow. They are never
  negative-cached, never count as failures and never sign the user out.
- Every account boundary bumps a session generation. Late responses from an
  older session are discarded and cannot write caches.

**WebSocket pipelines**

- Reconnect backoff starts at 1 s and doubles to 60 s, plus up to 250 ms of
  jitter. It resets only after a socket stayed open for 60 s.
- An upgrade answered with 429 shares the platform cooldown. Any other upgrade
  rejection is an ordinary failed attempt. It never signs the user out; dead
  sessions surface on REST.
- VRX sends no application heartbeat. Each successful open makes the renderer
  refetch the roster once over REST.
- Dead-connection detection adds no API requests. Both sockets turn on TCP
  keepalive (30 s idle, `SOCKET_KEEPALIVE_DELAY_MS`), and when the computer
  resumes from sleep, main drops each open socket once (`reconnectNow`); a
  screen unlock alone does not. The redial uses the normal backoff and 429
  cooldown, and resumes within 60 s count once. No socket has a message-silence watchdog:
  neither platform's server ping interval has been confirmed live.
- Decoders never throw on wire data. Unknown or malformed frames are dropped and
  debug-logged without payload contents.

**Images**

- Friend pictures, world thumbnails, group icons and Explore art are all fetched
  in main by the image cache and returned to the renderer as data URLs.
- A URL must be HTTPS on the default port, carry no credentials, be at most 2048
  characters and use an allowlisted host (listed per platform below).
- The body must be `image/png`, `image/jpeg`, `image/webp`, `image/gif` or
  `image/avif` and at most 3 MiB.
- Successes are cached for 1 h and failures for 30 s, within 200 entries and
  48 MiB. Any failure shows the letter placeholder.
- `api.vrchat.cloud` images are also kept on disk for 14 days (4,000 entries,
  128 MiB). This assumes VRChat file URLs are versioned
  (`/image/{fileId}/{version}/{size}`, `/file/{fileId}/{version}/file`), so a
  URL's picture never changes. If VRChat starts reusing a URL for new content,
  a stale picture can show for up to 14 days; shorten `IMAGE_DISK_TTL_MS`.

## VRChat

REST base `https://api.vrchat.cloud/api/1` (`VRC_API_BASE`). Pipeline
`wss://pipeline.vrchat.cloud/` (`VRC_PIPELINE_URL`).

| Surface                                  | Used for                                   | Evidence                          | When it breaks                          |
| ---------------------------------------- | ------------------------------------------ | --------------------------------- | --------------------------------------- |
| Session cookies and headers              | Every authenticated call                   | Live                              | Sign-in fails closed                    |
| `GET /auth/user` (Basic auth)            | Sign-in                                    | Live                              | Error result, tentative session cleared |
| `POST /auth/twofactorauth/{type}/verify` | Second factor                              | Live; email route Live 2026-07-28 | Retryable invalid-code result           |
| `GET /auth/user` (cookie)                | Session status, identity, presence buckets | Live                              | `error` state, session kept             |
| `GET /auth`                              | Pipeline token                             | Source-derived                    | Raw cookie value used instead           |
| `GET /auth/user/friends`                 | Friend roster                              | Live                              | Partial roster                          |
| `GET /worlds/{worldId}` (friends)        | World name and thumbnail                   | Live                              | No world metadata                       |
| `GET /groups/{groupId}`                  | Group name and icon                        | Source-derived                    | No group metadata                       |
| Explore routes                           | Public-world discovery                     | Synthetic                         | Explore problem state                   |
| `POST /invite/myself/to/{location}`      | Self-invite                                | Source-derived                    | `invite-failed`                         |
| Image endpoint and hosts                 | Pictures                                   | Live                              | Placeholder                             |
| Pipeline WebSocket                       | Live presence                              | Source-derived                    | REST reconcile only                     |
| `vrchat://launch` link                   | Join                                       | Source-derived                    | Join denied before launch               |
| `VRChatURLLaunchPipe` (Windows)          | Join while VRChat is open                  | Source-derived                    | One self-invite instead                 |
| Game process names                       | Is the game open?                          | Source-derived                    | Join launches as before                 |
| VRCX sign-in file                        | Sign-in from this PC (button)              | Source-derived                    | No import, password sign-in             |

### Session cookies and headers

- **Assumes:** sign-in and verify responses set `auth` and `twoFactorAuth`
  cookies through `Set-Cookie`. VRX sends them back as one `Cookie` header,
  `auth=…; twoFactorAuth=…`. Every request carries the VRX `User-Agent`.
- **Parses:** only the first `name=value` pair of each `Set-Cookie` line is
  read. `isValidVrcSessionCookie` accepts only `auth` and `twoFactorAuth` parts
  with printable-ASCII values. The cookie stays in main and never reaches the
  renderer.
- **Persistence:** a cookie is saved only after its owner is known. A restored
  cookie is held back from REST, the Pipeline and images until a status probe
  re-establishes its owner.
- **Uncertain:** cookie lifetimes are not documented. The `twoFactorAuth` cookie
  expires after some weeks; the status probe then returns the 2FA branch.
- **When it breaks:** a malformed issued cookie fails sign-in with
  `invalid_credentials`. A malformed stored cookie is ignored at start.

### Sign-in: `GET /auth/user` with Basic auth

- **Assumes:** `Authorization: Basic base64(urlencode(user):urlencode(pass))`. A
  401 means wrong credentials. A 200 body is either
  `{ requiresTwoFactorAuth: string[] }` or the current user `{ id, displayName }`.
  A 2FA reply sets a fresh `auth` cookie for that attempt.
- **Method codes (Source-derived, vrchatapi and VRCX):** authenticator accounts
  send `['totp', 'otp']`, where `otp` means recovery codes. Email accounts send
  `['emailOtp']`. Any list containing `emailOtp` (any case) routes to email;
  everything else routes to the authenticator.
- **Parses:** `id` must be `usr_<lowercase UUID>` or a conservative legacy id
  (no `usr_` prefix, 1 to 64 characters, no whitespace, control characters or
  colon). Credentials containing control characters are rejected locally. Sign-in
  resets the circuit first, so a deliberate attempt always reaches the network.
- **When it breaks:**
  - Other non-2xx statuses return `http_<status>`.
  - An unreadable or unmatched body returns `bad_response` or
    `unexpected_response`. Any cookie installed by that reply is discarded and the
    stored credential is deleted.
  - A 2FA reply without its own `auth` cookie returns `unexpected_response`. VRX
    never submits a code with an earlier account's cookie.
  - A success reply without a cookie is accepted only when the current cookie is
    already bound to the same account id.

### Second factor: `POST /auth/twofactorauth/{type}/verify`

| Code type            | Route                                             |
| -------------------- | ------------------------------------------------- |
| Authenticator (TOTP) | `/auth/twofactorauth/totp/verify`                 |
| Email code           | `/auth/twofactorauth/emailotp/verify`             |
| Recovery code        | `/auth/twofactorauth/otp/verify`, not used by VRX |

- **Assumes:** body `{ code }`. Success is a 2xx reply with `{ verified: true }`
  that sets `twoFactorAuth` and may rotate `auth`.
- **Has changed before (VRX-229):** the routes are not interchangeable. An email
  code posted to `otp/verify` is always rejected. The email route was confirmed
  on 2026-07-28 against the API reference, an unauthenticated probe (401, not
  404), VRCX and a real email-2FA sign-in. Check this table and a live probe
  before touching these routes.
- **Parses:** a non-2xx status, an unreadable body, `verified: false` or a
  non-boolean `verified` returns `invalid_2fa_code`. The prompt stays retryable
  and nothing is persisted. VRX keeps only the `auth` part of the old cookie, so
  a stale `twoFactorAuth` is never sent twice.
- **When it breaks:** after a verified code VRX reads `GET /auth/user` to bind the
  owner. If no owner is returned, the result is `AUTH_IDENTITY_UNAVAILABLE` and
  the tentative session is cleared.

### Session status: `GET /auth/user` with the cookie

- **Assumes:** the same two 200 branches as sign-in. The current-user branch may
  carry `onlineFriends`, `activeFriends` and `offlineFriends` id arrays.
- **Parses and reacts:**

  | Reply                                                   | VRX state                                                 |
  | ------------------------------------------------------- | --------------------------------------------------------- |
  | 401                                                     | `unauthenticated`; cookie cleared in memory and storage   |
  | 200 `requiresTwoFactorAuth`                             | `needs-2fa` with the method; code-only reprompt (VRX-173) |
  | 200 current user                                        | `authenticated`; a restored cookie is bound and persisted |
  | Other status, network error, unreadable or drifted body | `error`; session kept                                     |

- **2FA reprompt:** the cookie and stored credential stay, but REST, image and
  Pipeline consumers are revoked until the code verifies.
- **Bucket reuse (Synthetic):** when all three arrays parse, the next roster read
  may reuse them once, within 5 s, for the same owner and session. A new probe,
  any Pipeline event or a session boundary discards them. Missing or malformed
  arrays only disable reuse; they never fail authentication.

### Pipeline token: `GET /auth`

- **Assumes (Source-derived, VRCX pattern):** the reply is `{ token: string }`.
  The token goes in the Pipeline URL.
- **When it breaks:** a network error, a non-401 error status or another shape
  falls back to the raw `auth` cookie value (everything after the first `=`). A
  401 means the session was rejected: VRX emits `auth-invalidated` like any
  data-path 401, reports the socket down and stops dialing until the 2FA-aware
  status check settles the session. If that check still accepts the cookie, the
  Pipeline restarts and a repeat 401 falls back to the raw cookie instead of
  invalidating again. Without a durable session there is no token and the
  Pipeline waits. Failures never count toward the circuit.

### Friend roster: `GET /auth/user/friends`

- **Bucket probe:** each read first needs the three bucket arrays from
  `GET /auth/user`, unless fresh reused buckets exist. All three must be arrays
  of strings; explicitly empty arrays are valid.
- **Pages:** `?offset=<n>&n=100&offline=false`, then the same with
  `offline=true`. A page must be a JSON array. Records are validated one by one.
- **Record schema:** `id` and `displayName` are required. Missing, null or
  malformed `tags` become `[]` without dropping the friend. `iconUrl`, `currentAvatarImageUrl`, `userIcon`,
  `profilePicOverrideThumbnail`, `currentAvatarThumbnailImageUrl`, `location`,
  `status` and `statusDescription` are optional and nullable. Drift in `iconUrl`
  or `currentAvatarImageUrl` becomes null without dropping the friend. Unknown
  fields are ignored.
- **Limits:** at most 5000 friends (`MAX_FRIENDS`). A failed page is skipped; a
  pass stops after three consecutive failed pages. A friend listed in both
  passes keeps the later record and makes the roster partial, because the pages
  may have shifted.
- **Complete only when:** no page failed, no record was skipped, no friend was
  duplicated and the cap was not reached.
- **When it breaks:**
  - Bucket probe fails for a non-auth reason or returns malformed arrays: the
    read throws. The renderer keeps the last known roster and presence; VRX never
    invents an offline baseline.
  - A 401 anywhere emits `auth-invalidated` and keeps the cookie for the
    2FA-aware status check. A 403 is an ordinary error and never signs out.
  - A 429 stops both passes. Friends already read return as a partial roster with
    the cooldown attached; with none read, a `RateLimitError` is thrown.

### Friend fields: presence, status, trust and location

Presence `state` and VRChat `status` are separate axes
([parsePresence.ts](../src/main/services/adapters/vrchat/parsePresence.ts)).
`state` comes from bucket membership: `onlineFriends` is `in-game`,
`activeFriends` is `active`, anything else is `offline`.

| `status` (any case) | VRX status |
| ------------------- | ---------- |
| `join me`           | `join-me`  |
| `active`            | `online`   |
| `ask me`            | `ask-me`   |
| `busy`              | `dnd`      |
| `offline`, missing  | none       |
| anything else       | `online`   |

Trust comes from `tags`
([parseTrustRank.ts](../src/main/services/adapters/vrchat/parseTrustRank.ts)):
`system_trust_basic` is `new`, `system_trust_known` is `user`,
`system_trust_trusted` is `known` and `system_trust_veteran` is `trusted`. The
highest rank wins. `system_probable_troll` is `nuisance` and overrides rank. No
recognized tag is `visitor`. Unknown tags are ignored.

**Pictures.** The first non-empty value wins, in this order: `iconUrl`,
`userIcon`, `profilePicOverrideThumbnail`, `currentAvatarThumbnailImageUrl`,
`currentAvatarImageUrl`. VRChat uses `""` for unset. A
`https://api.vrchat.cloud/api/1/file/<file_id>/<version>[/file]` URL in `iconUrl`
or `currentAvatarImageUrl` is rewritten to the bounded
`/api/1/image/<file_id>/<version>/256` rendition. The full-size
`profilePicOverride` is not read because it can exceed the 3 MiB image limit.
Source-derived, checked 2026-09-24: the community
[friend schema](https://github.com/vrchatapi/specification/blob/c5f467d17087fc56f4f3dbc4e7f5b11d941ecd9a/openapi/components/schemas/LimitedUserFriend.yaml)
lists `iconUrl` and `currentAvatarImageUrl` but no longer lists `userIcon`,
`profilePicOverrideThumbnail` or `currentAvatarThumbnailImageUrl`. VRX keeps
those three only as fallbacks for older payloads.

**Location**
([parseLocation.ts](../src/main/services/adapters/vrchat/parseLocation.ts)).
The format is `<worldId>:<instanceId>[~tag(value)…]`. No instance is produced
when there is no colon, either part is empty, or the world part does not start
with `wrld_`. That covers `""`, `private`, `offline`, `traveling` and colon forms
such as `traveling:traveling`. `~region(x)` gives the region and `~group(x)` the
group id.

| Access tags                                               | Instance type  |
| --------------------------------------------------------- | -------------- |
| No recognized access tag                                  | `public`       |
| `~hidden(usr_…)`                                          | `friends-plus` |
| `~friends(usr_…)`                                         | `friends`      |
| `~private(usr_…)`                                         | `invite`       |
| `~private(usr_…)~canRequestInvite`                        | `invite-plus`  |
| `~group(grp_…)~groupAccessType(public)`                   | `group-public` |
| `~group(grp_…)~groupAccessType(plus)`                     | `group-plus`   |
| `~group(grp_…)` with `members`, missing or unknown access | `group`        |

- **Fallbacks:** an unknown non-group tag falls back to `public`. Unknown group
  access falls back to the restrictive `group`. Parsing never authorizes a join:
  main-owned `LocationAuthority` and strict launch validation still apply.
- **When it breaks:** a renamed access tag would label a restricted instance
  Public, and the game decides whether the join works. Do not widen the parser
  until the new format is known.

### World metadata: `GET /worlds/{worldId}`

- **Used:** in the background after a roster read and for an unseen world in a
  live event. At most 10 lookups run at once through normal admission, with no
  retry.
- **Schema:** `name` is required. `thumbnailImageUrl`, `capacity` (integer) and
  `shortName` each degrade to null on their own.
- **Cache:** 24 h for success, 60 s for failure, cleared at account boundaries.
  Each answer emits a `world-metadata` event that applies only to friends still in
  that world. On a cold start the renderer keeps cached names and thumbnails for
  friends still in the same world until fresh values arrive
  ([mergeKnownInstanceMetadata.ts](../src/renderer/src/utils/mergeKnownInstanceMetadata.ts)).
- **Uncertain:** whether VRChat answers an inaccessible world with 403 or 404.
- **When it breaks:**
  - A non-auth failure, a malformed body or a missing name resolves to null and is
    negative-cached for 60 s.
  - A 401 emits `auth-invalidated`.
  - A 403 denies that one world on a live session. It resolves to null, is
    negative-cached for 60 s like a missing world, and the rest of the batch
    continues. It still counts toward the circuit and never signs out.
  - Only 401 and 403 count toward the circuit. A 404, other error status,
    network error or unreadable body does not.
  - Rate limits, cancellation and admission overflow end the batch without
    caching.
  - Residual auth window: the roster returns before these lookups settle. A
    background 401 invalidates the session after the caller may already have
    seeded `LocationAuthority` from that roster.

### Group metadata: `GET /groups/{groupId}`

- **Assumes (Source-derived):** `name` is a non-empty string after trimming.
  `iconUrl` is optional. The group id is URI-encoded.
- **Cache:** 24 h for success, 60 s for failure, at most 512 entries. Answers
  emit `group-metadata` events for friends still in that group.
- **Uncertain:** the response shape has not been captured live, and the same
  403-or-404 question applies as for worlds.
- **When it breaks:** a missing name resolves to null and the UI shows no group
  name. A missing or drifted `iconUrl` becomes null and the card uses its
  placeholder. 401, 403 and other failures behave exactly as for worlds.

### Explore routes

All Explore reads use the durable session lease, one request each and no retry
([parseExplore.ts](../src/main/services/adapters/vrchat/parseExplore.ts)). They
are Synthetic.

| Route                                | Assumed shape                                                                       |
| ------------------------------------ | ----------------------------------------------------------------------------------- |
| `GET /worlds/active?n=12`            | Array of worlds. First 12 parsed.                                                   |
| `GET /worlds/{worldId}`              | World with `instances` as `[instanceId, userCount, object]` tuples. First 100 kept. |
| `GET /worlds/{worldId}/{instanceId}` | One room. Both ids validated, then URI-encoded.                                     |

- **Worlds:** `id` must be `wrld_<UUID>` and `name` non-empty. `occupants`
  (non-negative integer), `thumbnailImageUrl` and `popularity` are optional.
  Duplicates are dropped. A world detail must echo the requested `id`. More than
  100 tuples makes the visible-room count partial.
- **Strict public grammar for room ids:** the base is `[A-Za-z0-9_-]{1,80}` and
  not a sentinel such as `private`. Each modifier may appear once. Allowed
  modifiers are `region` (`us`, `use`, `usw`, `eu`, `jp`), `nonce` (with a
  value), `ageGate`, `group` (`grp_<UUID>`), `groupAccessType` (`public`, `plus`,
  `members`), `hidden`, `friends`, `private` (each with a value) and
  `canRequestInvite`. Public means no owner tag, no group and no
  `canRequestInvite`. Group Public means `group` plus `groupAccessType(public)`.
  Known non-public rooms are excluded. Anything unrecognized leaves coverage
  incomplete. The friend parser's public fallback does not apply here.
- **Room identity:** `worldId` and `instanceId` must equal the target. If
  present, `id` must be the instance id or `<worldId>:<instanceId>`, and
  `location` must be `<worldId>:<instanceId>`. The qualified `id` form follows a
  [source response report](https://github.com/vrchatapi/specification/issues/328);
  the field list follows the community
  [instance schema](https://github.com/vrchatapi/specification/blob/master/openapi/components/schemas/Instance.yaml).
- **Room evidence:** occupancy prefers `n_users`, then `userCount`. `capacity`,
  `region` and `groupName` are optional. A room is joinable only when the
  response `type` and `groupAccessType` agree with the id's access, the id is not
  age-gated, and these own fields hold exactly: `active: true`, `full: false`,
  `hasCapacityForYou: true`, `roleRestricted: false`, `ageGate: false`,
  `closedAt: null`, `hardClose: null`. Otherwise the room is full, restricted,
  unavailable or unknown. A missing or inherited closure field stays unknown.
- **When it breaks:** a malformed outer shape or identity mismatch raises
  `ExploreDataError` (shown as invalid data). A 401 or 403 marks the read
  unavailable, and a 401 also emits `auth-invalidated`. Rate limits end the
  batch. The last displayed snapshot is kept.

### Avatars

The Avatars page reads the user's own uploads and the worn avatar, and can
switch to one of those uploads
([parseAvatars.ts](../src/main/services/adapters/vrchat/parseAvatars.ts)). The
routes follow the community
[avatars API](https://github.com/vrchatapi/specification/blob/main/openapi/components/paths/avatars.yaml)
and VRCX. They are Source-derived; no real response has been captured yet. Reads
run only when the page opens or the user presses Refresh. Each switch is one
request with no retry, at most one every 5 s.

| Route                                                                                   | Assumed shape                                                       |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `GET /avatars?user=me&releaseStatus=all&sort=updated&order=descending&n=100&offset={n}` | Array of avatars. Pages of 100 until a short page, at most 500.     |
| `GET /users/{userId}/avatar`                                                            | The worn avatar. A failed or empty reply leaves the worn row empty. |
| `GET /avatars/{avatarId}`                                                               | One avatar. Read only when the list lacked dates and visibility.    |
| `PUT /avatars/{avatarId}/select`                                                        | Switches the worn avatar. The reply body is ignored.                |

- **Fields:** `id` must be `avtr_<UUID>` and `name` non-empty. `description`,
  `authorName`, `thumbnailImageUrl` (then `imageUrl`), `releaseStatus`
  (`public` or `private`), `created_at` and `updated_at` are optional. Image
  URLs must be `https`. Records that fail are skipped and mark the list
  incomplete.
- **When it breaks:** a non-array list page is unavailable. A 401 emits
  `auth-invalidated`; a 429 surfaces as rate-limited. The renderer keeps the
  last shown list.

### Profiles, search, lists, players online and groups

Read-only lookups for the Search and Groups pages, Explore's New and Recently
updated tabs, the full profile and the Dashboard's Playing now line
([parseCommunity.ts](../src/main/services/adapters/vrchat/parseCommunity.ts)).
Routes and fields follow the community
[specification](https://github.com/vrchatapi/specification) and VRCX. They are
Source-derived; no real response has been captured yet. Every read starts from
a user action (Enter, a page or tab opening, a Show press, Refresh) and is
cached in main for 5 minutes; nothing runs on a timer.

| Route                                                                                 | Assumed shape                                                           |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `GET /users/{userId}`                                                                 | One user: `displayName`, `bio`, `pronouns`, `tags`, `badges`, pictures. |
| `GET /users?search={text}&n=10`                                                       | Array of users.                                                         |
| `GET /worlds?search={text}&sort=relevance&tag=system_approved&n=10`                   | Array of worlds, as for Explore.                                        |
| `GET /worlds?sort=publicationDate\|updated&order=descending&tag=system_approved&n=12` | Array of worlds: New and Recently updated.                              |
| `GET /worlds?userId={userId}&releaseStatus=public&sort=updated&order=descending&n=24` | A person's public worlds.                                               |
| `GET /users/{userId}/groups`                                                          | Array of memberships: `groupId` (`grp_`), `name`, `shortCode`, counts.  |
| `GET /visits`                                                                         | A bare number: everyone online now.                                     |

- **Fields:** user ids must be `usr_<UUID>` (or a short legacy id of letters and
  digits); world ids `wrld_<UUID>`; group ids `grp_<UUID>`. Trust comes from
  `tags` like the friends list. Hidden badges are skipped and showcased ones
  come first, at most 8. Text is cut at 2,048 characters; image URLs must be
  `https`.
- **When it breaks:** a non-array reply (or a non-number for `/visits`) is
  unavailable; a 404 profile is not found. A 401 emits `auth-invalidated`; a
  429 surfaces as rate-limited.

### Self-invite: `POST /invite/myself/to/{location}`

- **Assumes (Source-derived):** body `{}`. The response is ignored.
- **Parses:** the location must match `^wrld_[A-Za-z0-9_-]+:[^/?#\\\s]+$` before
  it enters the path. The standalone `self-invite` handler refuses a public
  instance locally; a Join into an open VRChat may invite to one.
- **Reachability:** Join calls it when VRChat is open and the URL pipe is not
  used or refuses (see below). The standalone handler and bridge method still
  have no renderer control.
- **When it breaks:** a 401 emits `auth-invalidated`. Any failure returns
  `invite-failed`.

### Images

- **Hosts:** `api.vrchat.cloud`, `files.vrchat.cloud`, `assets.vrchat.com`.
- **Assumes:** `api.vrchat.cloud` image URLs need the session cookie (401
  without it) and redirect to a signed CDN URL on hosts VRChat rotates.
- **Rules:** only `api.vrchat.cloud` may redirect, at most 2 hops. The target must
  be HTTPS on the default port, with no credentials, and not an IP literal or
  localhost name. The target may not redirect again and never receives the
  cookie. API hops share VRChat admission and the session lease, and no API image
  loads before the session is durable.
- **When it breaks:** the letter placeholder shows. Cached failures are dropped
  at each VRChat session boundary so a new session retries them.

### Pipeline WebSocket

- **Connects to** `wss://pipeline.vrchat.cloud/?authToken=<encoded token>` with
  the VRX `User-Agent` and a 15 s handshake timeout. VRX never sends on this
  socket. The URL carries the token, so it is never logged.
- **Envelope (Source-derived):** `{ type: string, content }`. A string `content`
  is JSON-parsed again (double encoding). An object `content` is used as is.

| `type`                               | Content                       | VRX event                                                       |
| ------------------------------------ | ----------------------------- | --------------------------------------------------------------- |
| `friend-online`, `friend-location`   | `{ userId, user, location? }` | `friend-presence`, in game. Event `location` wins when present. |
| `friend-active`                      | `{ userid, platform, user }`  | `friend-presence`, active, no instance                          |
| `friend-offline`                     | `{ userId }`                  | `friend-offline`                                                |
| `friend-add`                         | `{ userId, user }`            | `friend-added`; state from `user.state`                         |
| `friend-delete`                      | `{ userId }`                  | `friend-removed`                                                |
| `friend-update`                      | `{ userId, user }`            | `friend-updated`; profile only, presence and instance kept      |
| `notification`                       | One Notification object       | `inbox` add for `invite`, `requestInvite`, `friendRequest` only |
| `hide-notification`                  | Bare notification ID          | `inbox` remove                                                  |
| `response-notification`              | `{ notificationId, … }`       | `inbox` remove                                                  |
| `clear-notification`                 | None                          | `inbox` clear                                                   |
| Other self, content and notification | Any                           | Dropped after decoding                                          |
| Anything else                        | Any                           | Dropped                                                         |

- **Dropped types:** `user-update`, `user-location`, `user-badge-assigned`,
  `content-refresh`, `see-notification` and `notification-v2*` are recognized
  but not routed.
- **Inbox (Source-derived, VRCX and the Notification schema):** a
  `notification` needs string `id`, `type` and `senderUserId`.
  `senderUsername` is optional. An invite's `details.worldName` is read whether
  `details` is an object (Pipeline) or a JSON string (REST); unreadable details
  leave the world unnamed. Other notification types (messages, votes to kick,
  responses, group notices) are ignored. `hide-notification` and
  `see-notification` carry a bare, non-JSON ID, so those types skip the second
  JSON parse. The inbox is view-only: VRX never answers, accepts or declines.
  VRX makes no REST read of pending notifications, so only what arrives while
  VRX is open is listed.
- **Parses:** `user` uses the roster record schema and the same normalizer.
  `friend-add` maps `user.state` `online` to in game and `offline` to offline;
  anything else or a missing state keeps the `active` fallback (Source-derived
  from the User schema and VRCX). A `traveling` location shows no instance until
  the next `friend-location`. `travelingToLocation` is accepted but unused.
- **Spelling:** `friend-active` documents its id as lowercase `userid`; VRX
  accepts `userId`, then `userid`, then `user.id`.
- **Assumes:** `userId` equals `user.id`. The event sets presence for `userId`,
  while normalization looks up `user.id`; if they ever differ, the friend
  normalizes as offline.
- **Uncertain:** the double encoding and the `friend-add` state come from
  community sources and have not been captured by VRX.
- **When it breaks:** malformed frames and payloads are dropped. If the socket
  cannot connect, presence comes only from the bucket arrays at each REST
  reconcile.

### Launch link: `vrchat://launch`

- **Builds** `vrchat://launch?ref=vrchat.com&id=<worldId>:<instanceId>` from
  main-owned instance data
  ([buildJoinUrl.ts](../src/main/services/adapters/vrchat/buildJoinUrl.ts)). The
  instance tags are not re-encoded. The link cannot choose desktop or VR; the
  VRChat client setting decides.
- **Validates** ([url-allowlist.ts](../src/main/ipc/url-allowlist.ts)): at most
  2048 characters, no `#` or `%`, only the `id` and `ref` parameters, `ref` equal
  to `vrchat.com`, and `id` matching
  `^wrld_[A-Za-z0-9_-]{1,128}:[A-Za-z0-9][A-Za-z0-9_~().-]{0,767}$`.
- **When it breaks:** the join is denied with `invalid-url` before
  `shell.openExternal`.

### Join into an open VRChat: `VRChatURLLaunchPipe`

- **Source-derived** from VRCX (`VRCIPC.cs`, `TryOpenInstanceInVrc`): VRChat's
  launcher forwards launch URLs to the running game through the Windows named
  pipe `\\.\pipe\VRChatURLLaunchPipe`. The client writes the UTF-8 URL and
  reads one byte; `1` means the game took it.
- **Sends** the same main-built URL that passed `isAllowedLaunchUrl`, nothing
  else, and only when the process check sees `VRChat.exe` and **When the game
  is already open** is **Go there**.
- **Linux and Proton:** the pipe lives inside the game's Wine container, which
  VRX does not enter (VRCX uses `nsenter` there). VRX sends a self-invite.
- **When it breaks:** no pipe, any other byte, a hang-up, or no answer within
  3 seconds means not taken; VRX then sends one self-invite. A game that took
  the URL but answered too late could also get that invite.

### Game process names

- **Assumes (Source-derived from VRCX and CVRX):** the games run as
  `VRChat.exe` and `ChilloutVR.exe`. On Linux, Wine and Proton set
  `/proc/<pid>/comm` to the same name. Matching is exact and case-insensitive.
- **When it breaks:** a renamed process reads as not running, so Join launches
  the game as it did before this feature.

### VRCX sign-in file

"Use my sign-in from VRCX" reads VRCX's saved VRChat cookies
([vrcxSessionImport.ts](../src/main/services/vrcxSessionImport.ts)), only when
the user presses it. VRX never writes any VRCX file.

- **Location:** `<appData>/VRCX/VRCX.sqlite3`, the `cookies` table, row
  `default`: base64 JSON of cookie records `{ Name, Value, Domain }`.
- **Source-derived (VRCX):** the shape follows VRCX's own cookie storage; not a
  documented format.
- **Defensive parsing:** the database is copied into a private temp folder and
  opened read-only. A non-empty `-wal`, `-shm` or `-journal` file counts as VRCX
  running and imports nothing. Symlinks, hard links, a changing source, more
  than 64 rows, 256 KiB of cookie data or 64 cookies import nothing. Exactly one
  `auth` cookie (and at most one `twoFactorAuth`) for `vrchat.cloud` is accepted.
- **After import:** `VrcAdapter.importSession` checks the cookie with
  `GET /auth/user` before it replaces anything. `requiresTwoFactorAuth` opens
  the normal code prompt; a 401 reports "no longer accepted".
- **When it breaks:** nothing is imported and password sign-in stays available.

## ChilloutVR

REST base `https://api.abinteractive.net/1` (`CVR_API_BASE`). Explore uses the
main-only base `https://api.chilloutvr.net`. The WebSocket is
`wss://api.chilloutvr.net/1/users/ws` (`CVR_WS_URL`).

| Surface                           | Used for                                 | Evidence                              | When it breaks                |
| --------------------------------- | ---------------------------------------- | ------------------------------------- | ----------------------------- |
| Session values and headers        | Every authenticated call                 | Source-derived                        | Sign-in fails closed          |
| `{ message, data }` envelope      | Every REST reply                         | Live 2026-07-08                       | Request fails                 |
| `POST /users/auth`                | Sign-in, restore check, 403 confirmation | Live                                  | Error result or `error` state |
| `GET /friends`                    | Friend roster                            | Live                                  | Partial roster                |
| `GET /instances/{id}`             | World, group and player count            | Live 2026-08-12                       | Socket values kept            |
| Privacy values                    | Access labels                            | Partly Live 2026-07-08 and 2026-08-12 | Unknown access, restrictive   |
| Explore routes                    | Public-world discovery                   | Synthetic                             | Explore problem state         |
| `/users/ws` WebSocket             | Live presence                            | Live 2026-07-07                       | Friends stay offline          |
| Image hosts                       | Pictures                                 | Live 2026-07-16                       | Placeholder                   |
| `chilloutvr://instance/join` link | Join                                     | Documented                            | Join denied before launch     |
| Local session files               | Sign-in from this PC (button)            | Source-derived, checked 2026-08-24    | No import, direct sign-in     |

### Session values and headers

- **Assumes:** a session is `{ username, accessKey }`. Every REST call and the
  WebSocket upgrade send the VRX `User-Agent`, `Platform: pc_standalone`,
  `CompatibleVersions: 0,1,2` and `MatureContentDlc: false`. Authenticated calls
  add `Username` and `AccessKey`. The server-side meaning of the fixed values is
  not documented; `pc_standalone` follows CVRX.
- **Parses:** both session values must be printable ASCII (`isValidCvrSession`)
  before header use or persistence. Headers are built after admission. The
  password is never stored.
- **When it breaks:** invalid issued values fail sign-in with
  `invalid_credentials` or sign out a restored session.

### Response envelope `{ message, data }`

- **Assumes:** every REST reply wraps its payload as `{ message, data }`. VRX
  validates `data` and discards `message`.
- **Live 2026-07-08:** `/friends` returns `message: null`, so `message` is
  accepted as a string, null or missing.
- **When it breaks:** any other envelope makes every REST call fail validation
  with `CVRNetworkError`.

### Sign-in and re-auth: `POST /users/auth`

- **Assumes:** body `{ AuthType, Username, Password }`. `AuthType: 2` signs in
  with the typed sign-in name (an email address) and password. `AuthType: 1`
  re-authenticates with the stored username and the access key as `Password`.
  A reply may rotate the access key.
- **Schema:** `data` requires only `username`, `accessKey` and `userId` (a
  GUID), the fields VRX uses. The reply also carries `currentAvatar`,
  `currentHomeWorld`, `videoUrlResolverExecutable`, `videoUrlResolverHashes`
  and `blockedUsers`; they are not validated, so a change to them cannot fail
  sign-in.
- **No second factor:** as of 2026-07 the reply has no 2FA field.
  `verify2fa` returns `unsupported_2fa`. If ChilloutVR adds 2FA, follow the seam
  described in `CvrAdapter.login`.
- **Sign-in results:** 401 or 403 is `invalid_credentials`. Other non-2xx
  statuses are `http_<status>`. An unreadable body is `bad_response`, and a
  schema mismatch is `unexpected_response`. Sign-in resets the circuit.
- **Restore:** a stored session is checked once per launch with `AuthType: 1`,
  because repeated re-auth can rotate or rate-limit the key. Later status checks
  trust it. 401 or 403 clears the session. Network errors, other statuses and
  unreadable or drifted replies report `error` and keep it. These checks never
  count toward the circuit. A rotated key is persisted before use.
- **Data-path auth failures:**
  - A 401 on any data call signs out at once and emits `auth-invalidated`.
  - A 403 can be a per-resource denial. VRX runs one confirming `AuthType: 1`
    request and signs out only if that is rejected or returns invalid values.
    Network trouble or an unreadable reply keeps the session. A rotated key is
    adopted. After a confirmed key, later 403s in that session do not re-check.
  - A 5xx never clears the session.
- **Uncertain:** access-key lifetime and how often rotation happens.

### Friend roster: `GET /friends`

- **Assumes:** `data` is one flat array of `{ id, name, imageUrl, categories }`.
  It carries no presence or instance data.
- **Parses:** `id` must be a GUID; it is trimmed and lowercased, the same as on
  the WebSocket. `name` is required. A drifted `imageUrl` becomes null.
  `categories` is ignored. One request per refresh, no retry.
- **Defaults:** every friend starts offline with no instance, status or trust
  rank. Main keeps the latest names so id-only socket entries can produce
  readable notifications.
- **When it breaks:** a bad record is skipped and the roster is partial. If every
  record is skipped, the read throws. A transport or envelope failure throws.

### Instance detail: `GET /instances/{id}`

- **Used:** in the background for each distinct instance id in a presence
  snapshot that is not cached. The id is URI-encoded.
- **Schema:** `id` is required. `name` (the creator-set label, which may end in
  `(#tag)`), `world: { id, name, imageUrl }`, `group: { id, name, image }`,
  `currentPlayerCount` and `instanceSettingPrivacy` each degrade to null. Unknown
  keys are ignored.
- **Live 2026-08-12:** group instances carry `group: { id, name, image }`
  (null otherwise), and `instanceSettingPrivacy` is a PascalCase string such as
  `Public`, `Friends` or `GroupPlus`.
- **Merge:** world id, name and image, player count and group come from REST.
  Privacy stays the socket value because it is fresher. Until a lookup succeeds,
  the socket label is the world-name fallback and the instance id stands in for
  the world id.
- **Cache:** 5 min for success (`INSTANCE_CACHE_TTL_MS`), 60 s for failure, at
  most 512 entries. Lookups never count toward the circuit.
- **Uncertain:** which status ChilloutVR returns for a private or closed instance.
- **When it breaks:**
  - A non-auth failure resolves to null, is negative-cached and re-emits the
    socket fallback.
  - A 401 signs out.
  - A 403 is negative-cached for 60 s, so later snapshots that still list the id
    do not request it again. It also starts the 403 confirmation, which runs at
    most once per session.

### Privacy values

[parseCvrPrivacy.ts](../src/main/services/adapters/cvr/parseCvrPrivacy.ts) maps
both forms. The socket sends numbers; `GET /instances/{id}` sends strings.

| Number | Type                       | Openness | Evidence                     |
| ------ | -------------------------- | -------- | ---------------------------- |
| 0      | `public`                   | public   | Live 2026-07-08              |
| 1      | `friends`                  | friends  | Source-derived (earlier app) |
| 2      | `friends`                  | friends  | Live 2026-07-08              |
| 3, 6   | `members-only`, group chip | invite   | Source-derived (earlier app) |
| 4, 5   | `owner-must-invite`        | invite   | Source-derived (earlier app) |
| 7      | `members-only`, group chip | invite   | Live 2026-07-08              |

Strings ignore case and punctuation but keep digits: `public`,
`friendsoffriends` (friends-of-friends), `friends`, `everyonecaninvite`
(everyone-can-invite), `ownermustinvite` (owner-must-invite), `groupsonly`
(members-only, group) and `groupplus` (friends-of-members, group).

- **Known divergence (VRX-264):** the string `GroupPlus` maps to
  friends-of-members, while number 6 stays members-only. Reconcile them only after
  a live capture of 6.
- **Unverified numbers understate access:** friends rather than friends of
  friends, owner-must-invite rather than everyone-can-invite.
- **Unknown or missing values** map to `owner-must-invite` with
  `opennessUnknown: true`. The UI then shows neutral Unknown access and policy
  pills instead of the fallback.
- **`GroupPublic`** is recognized only by Explore. In the friend map it is
  unknown. Presence always shows the socket number; the REST string is read only
  by `getInstanceDetails`, which has no 1.0 caller.
- **Offline instances:** no raw value maps to the shared `offline` type. The type
  stays accepted for restored or future data. `IsOnline: false` removes the
  friend from the online set instead. Do not add a mapping without a live
  capture.

### Explore routes

Explore uses typed routes on `https://api.chilloutvr.net` with the normal session
headers ([parseExplore.ts](../src/main/services/adapters/cvr/parseExplore.ts)).
Ids are validated before a URL is built, and the renderer cannot choose a host or
path. Each read is one request with no retry. They are Synthetic.

| Route                                                                   | Assumed shape                                                |
| ----------------------------------------------------------------------- | ------------------------------------------------------------ |
| `GET /2/worlds/list/wrldactive?page=0&sort=Default&direction=Ascending` | `data.entries` array of worlds. First 12 parsed.             |
| `GET /1/worlds/{worldId}`                                               | World with an `instances` array of `{ id }`. First 100 kept. |
| `GET /1/instances/{instanceId}`                                         | One room with `world.id` and privacy fields.                 |

- **Worlds:** `id` must be a GUID and `name` non-empty. The image comes from
  `imageUrl`, then `thumbnailUrl`. Category data gives no occupancy. A world
  detail must echo the requested `id`. Room ids must match the
  `i+<16 hex>-<6 hex>-<6 hex>-<8 hex>` grammar; any other entry makes coverage
  incomplete.
- **Rooms:** `id` and `world.id` must equal the target. Access comes from
  `instanceSettingPrivacy`, `privacy` or both. Only the exact strings `Public` and
  `GroupPublic` qualify, in any case. When both fields exist they must agree.
  `currentPlayerCount`, `maxPlayer`, `region` and `group.name` are optional.
  ChilloutVR has no capacity gate, so a full qualifying room stays joinable.
- **Known non-public rooms:** when every present privacy value is a recognized
  non-public string, the room is omitted. Numbers, unknown strings and conflicts
  raise `ExploreDataError`.
- **Totals:** a public player total sums unique qualifying rooms only when room
  coverage and every room count are complete; otherwise it is partial and not
  shown.
- **When it breaks:** shape or identity mismatches show as invalid data. Auth
  errors follow the data-path rules above. Rate limits end the batch. The last
  displayed snapshot is kept.

### Avatars

The Avatars page reads the user's own uploads and the worn avatar, and can
switch to one of those uploads
([parseAvatars.ts](../src/main/services/adapters/cvr/parseAvatars.ts)). Routes
and fields come from CVRX (`server/api_cvr_http.js`). They are Source-derived; no
real response has been captured yet. Reads run only when the page opens or the
user presses Refresh. Each switch is one request with no retry, at most one
every 5 s.

| Route                                  | Assumed shape                                                                    |
| -------------------------------------- | -------------------------------------------------------------------------------- |
| `GET /avatars`                         | Array of every avatar the user can wear: own, shared and favorites. One request. |
| `GET /users/{userId}`                  | The user, with `avatar` (`id`, `name`, `imageUrl`) as the worn avatar.           |
| `GET /avatars/{avatarId}`              | One avatar with `author.name`, `isPublished`, `uploadedAt` and `updatedAt`.      |
| `GET /avatars/{avatarId}/switchAvatar` | Switches the worn avatar. The reply body is ignored.                             |

- **Own uploads only:** a list entry is kept when `authorGuid` equals the
  signed-in user, or when it has no `authorGuid` and `categories` contains
  `avtrmine`. Shared and favorite avatars are left out so the page means the
  same thing on both platforms. At most 500 are kept.
- **Fields:** `id` must be a GUID (stored lower case) and `name` non-empty.
  `description` and `imageUrl` (`https`) are optional. The list has no dates or
  visibility; the details read fills them.
- **Unverified:** whether a switch takes effect while the game is running, or
  only on the next world load.
- **When it breaks:** a non-array list is unavailable. Auth errors follow the
  data-path rules above; a 429 surfaces as rate-limited.

### Profiles, search, lists, players online and groups

The same read-only lookups as VRChat
([parseCommunity.ts](../src/main/services/adapters/cvr/parseCommunity.ts)).
Routes and fields come from CVRX and the official client. They are
Source-derived; no real response has been captured yet. The same user-action
and 5-minute cache rules apply.

| Route                                                                              | Assumed shape                                                                                       |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `GET /users/{userId}`                                                              | `name`, `imageUrl`, `profileBio`, `profilePronouns`, `rank`, `featuredBadge`.                       |
| `GET /search/{text}`                                                               | Array mixing `type` `user`, `world`, `avatar` and `prop`; only people and worlds are kept.          |
| `GET https://api.chilloutvr.net/2/worlds/list/wrldnew\|wrldrecentlyupdated?page=0` | `{ entries }`, as for Explore: New and Recently updated.                                            |
| `GET /users/{userId}/worlds`                                                       | Array of `{ id, name, imageUrl }`.                                                                  |
| `GET /groups` and `GET /users/{userId}/groups`                                     | `{ owned, member }`, each an array of `{ id, tag, name, description, memberCount, image, banner }`. |
| `GET https://api.chilloutvr.net/1/public/userstats`                                | `{ usersOnline: { overall, … } }`.                                                                  |

- **Fields:** user, world and group ids must be GUIDs (stored lower case). A
  featured badge named `No badge featured` is skipped.
- **When it breaks:** a reply of the wrong shape is unavailable. Auth errors
  follow the data-path rules above; a 429 surfaces as rate-limited.

### WebSocket `/users/ws`

- **Connects** with the session headers on the upgrade and a 15 s handshake
  timeout. A restored session waits until its `AuthType: 1` check succeeds; with
  no session the loop waits and retries.
- **Envelope:** clean JSON, not double-encoded:
  `{ ResponseType, Data }` or `{ responseType, data }`. Both casings are
  accepted because the envelope casing has not been confirmed live.

| `ResponseType`           | VRX event                                                                       |
| ------------------------ | ------------------------------------------------------------------------------- |
| 10 `ONLINE_FRIENDS`      | `presence-snapshot` with the merged online set                                  |
| 11 `FRIEND_LIST_UPDATED` | `roster-changed`; the roster is refetched over REST                             |
| 15 `INVITES`             | `inbox` add, kind `invite` 🟡                                                   |
| 20 `REQUEST_INVITES`     | `inbox` add, kind `invite-request` 🟡                                           |
| 25 `FRIEND_REQUESTS`     | `inbox` add, kind `friend-request` 🟡                                           |
| 0, 1, 2, 30, 50          | Dropped after decoding (notifications, mature-content and group-invite updates) |
| Anything else            | Dropped                                                                         |

- **Inbox frames (🟡 Source-derived from CVRX and chilloutvr_rs, not yet seen
  live):** `15` is `[{ Id, User: { Id, Name }, World: { Name }, InstanceName }]`,
  `20` is `[{ Id, Sender: { Id, Name } }]` and `25` is `[{ Id, Name }]` where
  `Id` is the requesting user. Both casings are read, a single object counts as
  a one-item list, and at most 50 records are read per frame. An invite with no
  world name falls back to `InstanceName` without its ` (#n)` suffix. Bad
  records are skipped. A frame never removes rows, because it is unconfirmed
  whether a frame lists everything still open. A friend request clears when that
  person shows up on the roster.

- **Live 2026-07-07:** entries use PascalCase `Id`, `IsOnline` and
  `Instance: { Id, Name, Privacy }` with a numeric `Privacy`. The first
  `ONLINE_FRIENDS` frame after a connect is the full online set; later frames are
  one-entry deltas.
- **Merge:** the online set is cleared on each connect. Deltas merge into it,
  `IsOnline: false` removes a friend, and every emit is the full merged set. Both
  casings are accepted for entries too. Ids are GUIDs, trimmed and lowercased.
  The world id equals the instance id until REST enrichment. ChilloutVR has no
  active state, status or trust rank, and VRX never invents them.
- **Defensive parsing:**
  - A malformed instance becomes null and the friend shows as in a private
    instance.
  - A malformed entry is skipped. In the connect frame, a skipped entry with a
    readable GUID keeps that friend online with no instance, never the old join
    target.
  - A non-empty frame with no usable entry emits nothing and logs a warning. If
    it was the connect frame, VRX reconnects for a fresh full set, at most
    `MAX_UNUSABLE_FULL_SET_RESYNCS` (2) times in a row.
- **Outgoing:** `{ RequestType, Data }` senders exist for friend requests,
  unfriend, invites and blocking (types 5, 6, 7, 8, 10, 15, 30, 31). The payload
  shapes are Source-derived from CVRX notes. Nothing calls them in 1.0, and they
  never queue while disconnected.
- **Keepalive:** VRX sends none and relies on server pings, which `ws` answers
  with protocol pongs. The `RequestType 0` keepalive that CVRX reportedly sends
  is omitted until a live session shows it is needed.
- **Uncertain:** whether a friend who goes fully offline always gets an
  `IsOnline: false` delta. If not, that friend stays online until the next
  reconnect.
- **When it breaks:** without the socket, REST friends stay offline and the UI has
  no ChilloutVR presence.

### Image hosts

- **Hosts:** `files.chilloutvr.net`, `files.abidata.io`,
  `files.abinteractive.net`.
- **Live 2026-07-16:** a real `/friends` roster served all 166 `imageUrl`
  values from `files.chilloutvr.net`. `files.abidata.io` stays for older URLs
  named in CVRX sources.
- **Rules:** CDN requests carry no cookie or session header and never follow
  redirects. Each host has its own cooldown, and at most 4 bodies download at
  once across CDN hosts.
- **When it breaks:** a URL on a new host is refused and shows the placeholder
  until one allowlist entry is added.

### Launch link: `chilloutvr://instance/join`

- **Documented:** the official
  [deep-link documentation](https://docs.chilloutvr.net/chilloutvr/game/deep-link/)
  specifies `chilloutvr://instance/join?instanceId=<id>&startInVR=true|false`,
  with the `+` in `i+…` ids encoded as `%2B`.
- **Builds** the link only when the id matches
  `^i\+[0-9a-f]{16}-[0-9a-f]{6}-[0-9a-f]{6}-[0-9a-f]{8}$` (any case)
  ([buildCvrJoinUrl.ts](../src/main/services/adapters/cvr/buildCvrJoinUrl.ts)).
  `startInVR` follows the chosen join mode.
- **Open game (Source-derived from CVRX):** when ChilloutVR is already running,
  the game picks up the same link, and `startInVR` no longer applies. CVRX's
  "Join In-Game" sends exactly this.
- **Validates:** exactly those two parameters, in that order and encoding, with
  `startInVR` equal to `true` or `false`.
- **When it breaks:** the join is denied with `invalid-url` before
  `shell.openExternal`.

### Local session import files

"Use my sign-in from ChilloutVR" reads an existing ChilloutVR session from
local files ([cvrSessionImport.ts](../src/main/services/cvrSessionImport.ts)),
only when the user presses it. VRX never writes either source.

| Source           | Location                                             | Assumed shape                                                   |
| ---------------- | ---------------------------------------------------- | --------------------------------------------------------------- |
| Game profile     | `ChilloutVR_Data/autologin*.profile` (folders below) | XML root `LoginProfile` with one `Username` and one `AccessKey` |
| CVRX config      | `<appData>/CVRX/CVRConfigs/config.json`              | `{ FileVersion: 1, data: { ActiveUsername, CVRExecutable } }`   |
| CVRX credentials | `<appData>/CVRX/CVRConfigs/credentials.json`         | `{ FileVersion: 1, data: { <key>: { Username, AccessKey } } }`  |

- **Game folders:** each Steam library's
  `steamapps/common/ChilloutVR/ChilloutVR_Data`, plus the `ChilloutVR_Data`
  folder next to the CVRX `CVRExecutable` when it is an absolute local path to
  `ChilloutVR.exe` or `ChilloutVR` (any case).
- **Steam libraries:** Windows uses `Steam` under the Program Files folders,
  Linux uses `~/.local/share/Steam` and `~/.steam/steam`, and macOS uses
  `<appData>/Steam`. Each Steam root is a library, and extra libraries come
  from `"path"` entries in its `steamapps/libraryfolders.vdf`.
- **Source-derived, checked 2026-08-24:** the CVRX wrapper and field names follow
  [CVRX `server/config.js`](https://github.com/AstroDogeDX/CVRX/blob/main/server/config.js).
- **Selection:** one unique profile pair wins. Several profiles are narrowed to
  the CVRX `ActiveUsername`. Otherwise one unique CVRX credential is used,
  matching `ActiveUsername` when it is set. Any remaining ambiguity imports
  nothing.
- **Defensive parsing:**
  - A DOCTYPE, CDATA, processing instruction, nested element or duplicate field
    invalidates a profile.
  - Limits: JSON 1 MiB, profile 128 KiB, `libraryfolders.vdf` 1 MiB, 512
    directory entries, 128 CVRX records, 16 game data folders, 32 profile files,
    750 ms per file operation and 1 s overall.
  - Symlinked, non-regular or oversized files are skipped. Relative and network
    (UNC) paths are ignored, and an unsafe app-data or home root stops the
    import before any read.
  - Timeouts, budget overruns and files or folders that change identity during
    the read disable the profile source; VRX then uses CVRX only.
- **After import:** both values must be printable ASCII. `CvrAdapter.importSession`
  checks the pair with `AuthType: 1`, then saves the key CVR returns with its
  owner. A rejected pair changes nothing.
- **When it breaks:** any drift imports nothing and direct sign-in stays
  available. VRX does not migrate or repair either source.

## Open questions

| Platform   | Question                                                           | Current safe behavior                                               |
| ---------- | ------------------------------------------------------------------ | ------------------------------------------------------------------- |
| VRChat     | Does an inaccessible world or group return 403 or 404?             | 404 and 403 are negative-cached; 403 also counts toward the circuit |
| VRChat     | Is Pipeline `content` always double-encoded?                       | Both string and object accepted                                     |
| VRChat     | Does `friend-add` always carry `user.state`?                       | Missing state falls back to active                                  |
| ChilloutVR | What do numbers 1, 3, 4, 5 and 6 mean on the live socket?          | Earlier-app mapping, understating access                            |
| ChilloutVR | Does a friend going offline always get an `IsOnline: false` delta? | Online set is rebuilt on every reconnect                            |
| ChilloutVR | Which status does a private or closed instance return?             | Failures and 403 negative-cached; 403 confirmed once                |
| ChilloutVR | How long does an access key live, and when does it rotate?         | Rotations persisted; dead keys surface as 401                       |

## How to update this doc

- When an observed shape, status code, host or value changes, or an open question
  is answered, update that surface's entry: the assumption, the parsing, the
  evidence label with its date, and the behavior when it breaks.
- Record a new observed shape here before broadening a parser. Do not widen a
  parser only because a value looks plausible.
- Replace superseded observations instead of appending history. Keep one dated
  line per observation that still explains current code.
- A new image or launch host needs an allowlist change and an entry here in the
  same pull request.
- Describe shapes, never paste raw payloads, credentials or personal data.
- Policy changes (pacing, retries, cooldowns, User-Agent, Explore budgets,
  etiquette) also update [API policy](api-policy.md).
- Keep both platforms at the same structure and level of detail.
