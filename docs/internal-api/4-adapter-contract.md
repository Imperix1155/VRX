# 4. Platform adapter contract

Part of the [internal API catalog](../INTERNAL-API.md). The code is the source of truth: read the file a row names before relying on it.

Both platforms implement [`IPlatformAdapter`](../../src/main/services/adapters/IPlatformAdapter.ts). `app.ts` creates one `VrcAdapter` and one `CvrAdapter`, keyed by platform, and passes them to IPC registration, Explore and event wiring. The rest of the app speaks `@shared/types` and never touches raw platform APIs. Adapter code stays Electron-free; credential stores, sockets and logging are injected.

## `IPlatformAdapter`

| Symbol | File | Purpose |
| --- | --- | --- |
| `IPlatformAdapter` | [`IPlatformAdapter.ts`](../../src/main/services/adapters/IPlatformAdapter.ts) | Main-only platform contract with a readonly `platform`. Adding a platform means implementing this interface. |
| `getAuthStatus()` | same | → `AuthStatus`. A 401 clears the session. VRChat `needs-2fa` keeps the cookie but stops consumers until 2FA succeeds. ChilloutVR validates a restored key once per launch, then trusts memory. Unreadable replies report `error` without clearing. |
| `login(credentials)` | same | → `LoginResult`. Success arrives only after secure persistence; otherwise `credential_persistence_failed` with `sessionCleared: true`. VRChat may return `needs2fa`. ChilloutVR logs in with email and password. |
| `verify2fa(code)` | same | Completes VRChat 2FA with the pending session; if the owner lookup then yields no account id, returns `auth_identity_unavailable`. ChilloutVR resolves `{ ok: false, needs2fa: false, error: 'unsupported_2fa' }`. |
| `clearSession()` | same | Explicit logout. Deletes the persisted credential before clearing memory, throws if deletion fails, cancels held auth work and emits `auth-invalidated`. ChilloutVR uses the store's `signOut()` when present. |
| `getFriends()` | same | → `FriendRoster`. A read with no usable roster rejects. Skipped records or a batch stopped by a 429 return `partial`. |
| `buildJoinUrl(instance, mode)` | same | Pure URL builder, or `null`. VRChat ignores `mode` (`vrchat://launch?ref=vrchat.com&id=…`). ChilloutVR emits `chilloutvr://instance/join?instanceId=…&startInVR=…`. Rule: callers validate with `isAllowedLaunchUrl` and own the launch. |
| `selfInvite(instanceId)` | same | VRChat takes the full `worldId:instanceId` location, validates it, refuses public instances and posts `/invite/myself/to/<location>`. ChilloutVR rejects. |
| `subscribe(handler)` | same | Live `AdapterEvent` stream → `Unsubscribe`. One shared pipeline per adapter starts with the first subscriber and stops with the last. |
| `FriendRoster` | same | `{ friends, completeness, rateLimit?, seeds? }`. `rateLimit` (`retryAfterMs`) and `seeds` (per-read revision and rows) are main-only and never cross IPC as-is. |
| `RosterCompleteness`, `Unsubscribe` | same | `'complete' \| 'partial'`; `() => void`. |

Rule (auth results): a failed `LoginResult` whose path discarded local auth state carries `sessionCleared: true`, and the renderer must set that platform's auth cache to unauthenticated. `credential_persistence_failed` and `auth_identity_unavailable` are terminal: no identity or pipeline is published.

Rule (identity): both adapters publish `onIdentity(null)` before an identity-clearing session boundary and publish the account id only after auth state settles; main feeds it to `AccountSession`. `onSessionBoundary` makes main clear `FriendAlerts`, `LocationAuthority` and Explore for that platform and push `identity-boundary`. A VRChat data-path 401 passes `identityRetained: true` instead: main still clears its state but sends no `identity-boundary`, because the following `auth-invalidated` quarantines the renderer. A ChilloutVR same-account access-key rotation also passes `identityRetained: true`: main clears nothing for ChilloutVR and sends no `identity-boundary`. Main's credential-store closures ignore the `accountId` argument of `save`; there is no separate owner store (#371).

Rule (auth fencing): a later login supersedes an earlier one at its next await, explicit logout cancels active and queued auth work, and a session that is still being saved cannot serve data. Authenticated requests during that window throw `AuthSessionPendingError`, and the VRChat avatar cookie reads as `null`.

## Explore capability (`ExploreAdapter`)

| Symbol | File | Purpose |
| --- | --- | --- |
| `ExploreAdapter` | [`ExploreAdapter.ts`](../../src/main/services/adapters/ExploreAdapter.ts) | Narrow main-only discovery capability. It does not extend `IPlatformAdapter`. Both adapters implement it; only `ExploreService` calls it. |
| `captureExploreLease()` | same | Captures the current session lease. Throws while the session is not durably ready. |
| `getExploreCandidates(context)` | same | One active-worlds request. Parses at most 12 records into `ExploreWorldEvidence[]`. |
| `getExploreWorld(worldId, context)` | same | One world-detail request → `ExploreWorldDetail \| null` (`world`, up to 100 `roomIds`, `roomsComplete`, and `about`: the creator, description, tags and room size parsed from the same response). More rooms than that mark the room count partial. |
| `getExploreRoom(target, context)` | same | One room-detail request → `ExploreRoomEvidence \| null` with `joinEligibility`. A response for another world or room is an error. |
| `ExploreRequestContext` | same | `{ lease, signal, priority, beforeDispatch }` from `ExploreService`. Adapters send it as `retry: 'none'`, so each call is one physical request; `beforeDispatch` is the service's per-minute start budget. |
| `ExploreWorldEvidence`, `ExploreRoomEvidence`, `ExploreWorldDetail` | same | Evidence without renderer references: world evidence omits `worldRef`, room evidence omits `action` and adds `joinEligibility`. Main issues opaque references only after rechecking evidence. |
| `ExploreDataError` | same | The authenticated response was structurally unusable or named a different identity than requested. |

## Avatar capability (`AvatarLibraryAdapter`)

| Symbol | File | Purpose |
| --- | --- | --- |
| `AvatarLibraryAdapter` | [`AvatarLibraryAdapter.ts`](../../src/main/services/adapters/AvatarLibraryAdapter.ts) | Narrow main-only capability for the Avatars page. It does not extend `IPlatformAdapter`. Both adapters implement it; only `AvatarLibraryService` calls it. Each request is sent once (`retry: 'none'`). |
| `captureAvatarLease()` | same | Captures the current session lease. Throws while the session is not durably ready. |
| `getOwnAvatars(lease)` | same | The user's own uploads → `{ avatars, complete }`, at most `AVATAR_LIBRARY_MAX_ITEMS` (500). VRChat pages 100 at a time and stops at a 429; ChilloutVR reads one list and keeps the user's own. |
| `getCurrentAvatar(lease)` | same | The worn avatar, or `null` when the reply names none. An unreadable reply throws `AvatarDataError`. |
| `getAvatarDetails(avatarId, lease)` | same | One avatar → `AvatarItem \| null`. A response for another id is `null`. |
| `switchAvatar(avatarId, lease)` | same | One switch request with `retry: 'none'`. |
| `AvatarDataError` | same | The authenticated response was structurally unusable. |
| `AvatarLibraryService` | [`avatarLibraryService.ts`](../../src/main/services/avatarLibraryService.ts) | Per-platform state fenced by lease generation: known ids, details cache, the shared in-flight listing, the switch lock and cooldown. `clearPlatform` runs on every session boundary and `auth-invalidated`. Logs carry only platform and reason. |
| `CurrentAvatarService` | [`currentAvatarService.ts`](../../src/main/services/currentAvatarService.ts) | The Dashboard's worn-avatar read: `getCurrentAvatar` alone, under a captured avatar lease, sharing one in-flight read per session. Keeps nothing between reads and never adds a switch target. Logs carry only platform and reason. |
| `parseVrcAvatar*`, `parseCvr*Avatar*` | [`vrchat/parseAvatars.ts`](../../src/main/services/adapters/vrchat/parseAvatars.ts), [`cvr/parseAvatars.ts`](../../src/main/services/adapters/cvr/parseAvatars.ts) | Turn platform records into `AvatarItem`. Text is trimmed and bounded, image URLs must be `https`, and records without a valid id or name are skipped. |
| `record`, `text`, `imageUrl`, `isoDate`, `byNewestChange`, `RecordValue` | [`avatarItemFields.ts`](../../src/main/services/adapters/avatarItemFields.ts) | Defensive field readers both platforms' avatar parsers share: plain records, trimmed text, HTTPS picture addresses, ISO dates, newest-first sort. |

ChilloutVR REST uses `api.abinteractive.net/1`. Explore discovery uses fixed typed routes on `api.chilloutvr.net`, the host that also serves the `/users/ws` socket. A 401 during Explore follows the same data-path invalidation as other requests.

## Home world capability (`HomeWorldAdapter`)

| Symbol | File | Purpose |
| --- | --- | --- |
| `HomeWorldAdapter` | [`HomeWorldAdapter.ts`](../../src/main/services/adapters/HomeWorldAdapter.ts) | Narrow main-only write capability: make one world the signed-in account's home. It does not extend `IPlatformAdapter`. Both adapters implement it; only `HomeWorldService` calls it. |
| `captureHomeWorldLease()` | same | Captures the current session lease. Throws while the session is not durable. |
| `setHomeWorld(worldId, lease)` | same | One request with `retry: 'none'`: VRChat `PUT /users/{me}` `{ homeLocation }`, ChilloutVR `GET /worlds/{id}/sethome`. A malformed ID throws `HomeWorldIdError` before any request. |
| `HomeWorldService` | [`homeWorldService.ts`](../../src/main/services/homeWorldService.ts) | Per-platform lock and cooldown fenced by lease generation. Resolves the renderer's reference with `resolveWorld`, checks the ID shape, and logs only platform and reason. `clearPlatform` runs on every session boundary and `auth-invalidated`. |
| `HOME_WORLD_COOLDOWN_MS`, `isHomeWorldId`, `SetHomeWorldResult` | [`@shared/homeWorld`](../../src/shared/homeWorld.ts) | 5 s spacing, the world-ID shape check (`wrld_<GUID>` or a GUID), and the IPC result. |

## Community capability (`CommunityAdapter`)

| Symbol | File | Purpose |
| --- | --- | --- |
| `CommunityAdapter` | [`CommunityAdapter.ts`](../../src/main/services/adapters/CommunityAdapter.ts) | Narrow main-only read capability for profiles, search, world lists, players online and the user's groups. It never writes and does not extend `IPlatformAdapter`. Both adapters implement it; only `CommunityService` calls it. Each call takes the service's lease. |
| `CommunityList<T>` | same | `{ items, complete }`; `complete` is false when a reply was cut at VRX's cap or records were skipped. |
| `CommunityDataError` | same | A signed-in reply that was structurally unusable. `getProfile` returns `null` only when the platform answers 404, and throws this for a reply it can't read or one naming someone else. |
| `CommunityService` | [`communityService.ts`](../../src/main/services/communityService.ts) | Per-platform caches (5 min), shared in-flight reads, the search cooldown and the set of people a search listed. `wasListed` tells friend actions whether a search listed a person. Refuses a profile for anyone who is neither a friend (`LocationAuthority.hasFriend`) nor listed. Adopts search and list worlds through `ExploreService.adoptWorlds`. `clearPlatform` runs on every session boundary and `auth-invalidated`. Logs carry only platform and reason. |
| `parseVrc*` (community), `parseCvr*` (community) | [`vrchat/parseCommunity.ts`](../../src/main/services/adapters/vrchat/parseCommunity.ts), [`cvr/parseCommunity.ts`](../../src/main/services/adapters/cvr/parseCommunity.ts) | Shape and id checks for people, profiles, worlds, groups and player counts. |

## Friend action capability (`FriendActionsAdapter`)

| Symbol | File | Purpose |
| --- | --- | --- |
| `FriendActionsAdapter` | [`FriendActionsAdapter.ts`](../../src/main/services/adapters/FriendActionsAdapter.ts) | Narrow main-only write capability for friend requests. It does not extend `IPlatformAdapter`, and `CommunityAdapter` stays read-only. Both adapters implement it; only `FriendActionsService` calls it. Each call takes the service's lease. Later friend writes (unfriend, block) belong here. |
| `captureFriendActionLease()` | same | Captures the current session lease. Throws while the session is not durably ready. |
| `canSendFriendAction()` | same | False when an action could not leave now (ChilloutVR socket closed); the service then refuses the press as `unavailable` instead of letting it wait. VRChat is always true. |
| `answerFriendRequest(record, answer, lease)` | same | `FriendRequestRecord` `{ sourceId, senderId }` from the inbox. VRChat: `PUT /auth/user/notifications/{sourceId}/accept` or `/hide`. ChilloutVR: `RequestType` 6 or 7 on `/users/ws` for `senderId`. |
| `sendFriendRequest(userId, lease)` | same | VRChat: `POST /user/{id}/friendRequest`. ChilloutVR: `RequestType` 5. Refuses a malformed ID or the signed-in user before sending. |
| `FriendActionRefusedError` / `FriendActionUnavailableError` | same | The platform answered 4xx, or the ChilloutVR socket is not open (the frame is never queued). |
| `FriendActionsService` / `MAX_SENT_FRIEND_REQUESTS` | [`friendActions.ts`](../../src/main/services/friendActions.ts) | Per-platform state fenced by lease generation: a serial queue spaced `FRIEND_ACTION_SPACING_MS` after every attempt, at most `FRIEND_ACTION_MAX_WAITING` waiting, one run per row or person, and the people sent a request this session (200). Answers need an `InboxService.friendRequest` row; sends need `CommunityService.knowsPerson` and not `LocationAuthority.hasFriend`; `forgetRequest` drops a sent mark after VRX unfriends them. `clearPlatform` runs on every session boundary and `auth-invalidated`. Logs carry only platform, action and reason. |
| `VrcApiClient.sendWrite` | [`VrcApiClient.ts`](../../src/main/services/adapters/VrcApiClient.ts) | A bodiless `PUT` or `POST` through `rawRequest` that returns the status for the caller to read. |

## Account note capability (`AccountNoteAdapter`)

| Symbol | File | Purpose |
| --- | --- | --- |
| `AccountNoteAdapter` | [`AccountNoteAdapter.ts`](../../src/main/services/adapters/AccountNoteAdapter.ts) | Main-only read and write of the user's own note on a friend. Kept apart from the read-only `CommunityAdapter` because it writes. Both adapters implement it; only `AccountNoteService` calls it. A reply without a `note` is unknown (`null`), never empty. |
| `AccountNoteService` | [`accountNotes.ts`](../../src/main/services/accountNotes.ts) | One call per friend at a time, writes 2 s apart per platform, never resent. Writes only for a current friend and only after reading the account copy in the same call. Never takes an account copy longer than VRX keeps (`FRIEND_NOTE_MAX_LENGTH`, 500): it answers `account-too-long` and leaves that copy on the account. `clearPlatform` runs on every session boundary and `auth-invalidated`. |
| `GameFavoritesAdapter` | [`GameFavoritesAdapter.ts`](../../src/main/services/adapters/GameFavoritesAdapter.ts) | Main-only read and write of the favorite groups in the user's own account. Both adapters implement it; only `GameFavoritesService` calls it. VRChat: `POST /favorites` / `DELETE /favorites/{id}`; ChilloutVR: reads the item's categories, then `POST /categories/assign` with the whole list. Reply checks and group keys live beside the interface. |
| `GameFavoritesService` | [`gameFavorites.ts`](../../src/main/services/gameFavorites.ts) | One read per sign-in (default priority, so it runs ahead of background name lookups), a failed read backs off 5 minutes, Refresh after 60 s. Writes one per press, 2 s apart per platform, never resent; checks the revision, a current friend, VRChat's one-group rule and group caps first, and again when the press reaches the front of the write queue, so a second press for the same item is answered from what the first one changed. Off with Settings → Use my game favorites. `clearPlatform` runs on every session boundary and `auth-invalidated`. `peek(platform)` returns what is already loaded for the signed-in account, or null, and never starts a read (used by the export). |
| `decideAccountNote` etc | [`accountNotes.ts`](../../src/shared/accountNotes.ts) | The pure compare: `in-sync`, `take-account`, `send-local`, `conflict`; VRChat's one-line, 256-character form and look-alike symbols; `fitsVrxNote` for the 500-character VRX cap. |
| `useAccountNote` | [`useAccountNote.ts`](../../src/renderer/src/hooks/useAccountNote.ts) | The drawer's side: a check after the drawer stays open 0.7 s; a save after each saved edit, heard through `subscribeFriendNoteSaved` so a save flushed by closing the drawer still reaches the account; taking the account copy on its own only when VRX's copy is unchanged and the user is not typing. A failed call keeps whether the platform asked to slow down, so the line says so. Shown by `AccountNoteStatus`. |

## Unfriend and block capability (`SocialActionAdapter`)

| Symbol | File | Purpose |
| --- | --- | --- |
| `SocialActionAdapter` | [`SocialActionAdapter.ts`](../../src/main/services/adapters/SocialActionAdapter.ts) | Narrow main-only capability for the profile's Unfriend, Block and Unblock, plus the one block-state read. Does not extend `IPlatformAdapter`. Both adapters implement it; only `SocialActionService` calls it, with its lease. VRChat: `GET /auth/user/playermoderations` (whole list, as VRCX; one read serves every profile for 5 minutes), `DELETE /auth/user/friends/{id}`, `POST /auth/user/playermoderations` and `PUT /auth/user/unplayermoderate` with `{ moderated, type: 'block' }`, all `retry: 'none'`. ChilloutVR: `GET /users/{id}` (`isBlocked`) and `/users/ws` `RequestType` 8, 30, 31 on the current account's socket. |
| `SocialDataError` | same | A malformed person ID or an unusable reply. |
| `SocialNotSentError` | same | The ChilloutVR socket was closed, so nothing was sent. |
| `SocialActionService` | [`socialActionService.ts`](../../src/main/services/socialActionService.ts) | Per-lease memory of block answers (5 min, 100 people). A block check that fails for any reason but a sign-out (`401`, a pending or cancelled session) or a slow-down answers `blocked: null` so the actions stay, and is not remembered; a `403` is a refusal, never `not-authenticated`. An Unfriend that went through calls `unfriended`, which main wires to `LocationAuthority` and `forgetRequest`. Acts only on a friend (`LocationAuthority.hasFriend`), someone a search listed (`CommunityService.knowsPerson`), or someone it already answered for this session. One action per platform at a time and `SOCIAL_ACTION_COOLDOWN_MS` (3 s) after the answer. `clearPlatform` runs on every session boundary and `auth-invalidated`. Logs carry only platform, kind and reason. |
| `parseVrcBlockList`, `isVrcBlocked` | [`vrchat/parseBlocked.ts`](../../src/main/services/adapters/vrchat/parseBlocked.ts) | The set of people with a `block` record in the user's whole moderation list (other types ignored); `null` for a reply that is not a list. `isVrcBlocked` is true for someone in the set, false for someone not in a complete list, `null` past `MAX_MODERATIONS` (20,000) records. |
| `SOCIAL_ACTIONS`, `SOCIAL_ACTION_COOLDOWN_MS`, `RELATIONSHIP_CACHE_MS`, `Relationship`, `RelationshipResult`, `SocialActionResult` | [`@shared/socialActions`](../../src/shared/socialActions.ts) | The renderer-safe vocabulary. |

## Own profile capability (`OwnProfileAdapter`)

| Symbol | File | Purpose |
| --- | --- | --- |
| `OwnProfileAdapter` | [`OwnProfileAdapter.ts`](../../src/main/services/adapters/OwnProfileAdapter.ts) | Narrow main-only capability to read and write the signed-in user's own profile. It does not extend `IPlatformAdapter`. Both adapters implement it; only `OwnProfileService` calls it. VRChat reads `GET /profile/{me}?asSelf=true` and writes the bio with `PUT /profile/{me}` and the pronouns and status with `PUT /users/{me}`, each only when it changed (`VrcApiClient.putJson`); ChilloutVR reads `GET /users/{me}` and writes one multipart `POST /users/self` per changed field (`CvrApiClient.postForm`). Writes use `retry: 'none'`. |
| `OwnProfileDataError` | same | A signed-in reply that was structurally unusable. |
| `OwnProfileService` | [`ownProfileService.ts`](../../src/main/services/ownProfileService.ts) | Per-platform state under one session lease: the last read (reused for 30 s), a shared in-flight read, one Save at a time, 5 s after any attempt. Normalizes and checks the renderer's changes and sends only what differs from the last read (reading first after a session renewal). A failed Save drops the last read, so the next open and the next Save read again first. `clearPlatform` runs on every session boundary and `auth-invalidated`. Logs carry only platform and reason, never profile text. |
| `parseVrcOwnProfile`, `vrcOwnProfileBody`, `parseCvrOwnProfile`, `ownText` | [`vrchat/parseOwnProfile.ts`](../../src/main/services/adapters/vrchat/parseOwnProfile.ts), [`cvr/parseOwnProfile.ts`](../../src/main/services/adapters/cvr/parseOwnProfile.ts), [`ownProfileFields.ts`](../../src/main/services/adapters/ownProfileFields.ts) | The editable fields, only for the signed-in account's id; a non-string text field makes the reply unreadable. VRChat status words map both ways (`active` is Online, `busy` is Do Not Disturb). |

## Request admission and queue

Rule: every platform HTTP request goes through `BaseAdapter` and the platform's `ApiAdmissionController`. Never call `fetch` for a platform API elsewhere. `app.ts` creates one controller per platform and shares it with that adapter's REST, Explore, VRChat API hops in `AvatarCache`, and the pipeline's dial cooldown. Starts are spaced by `API_REQUEST_MIN_INTERVAL_MS` (1 s) plus up to 99 ms of jitter. Every physical retry reacquires admission and observes the latest shared 429 cooldown. Cancellation, queue overflow and a pending session are control flow: stop later pages or enrichment, do not count a circuit failure, and do not negative-cache.

| Symbol | File | Purpose |
| --- | --- | --- |
| `ApiAdmissionController` | [`ApiAdmissionController.ts`](../../src/main/services/adapters/ApiAdmissionController.ts) | The per-platform start queue. It holds no credentials and does no I/O. |
| `acquire(options)` | same | Waits for a start slot. Order: retry waits (`notBefore`), then `interactive`, `default`, `background`. Rejects with `RequestCancelledError` on abort, `RequestQueueFullError` when full, `RateLimitError` for `rejectOnCooldown` work in a cooldown. |
| `rateLimited(retryAfter)` | same | Records a 429. Honors `Retry-After` (seconds or HTTP date) or falls back to 1 s doubling up to 30 s, adds jitter, extends the shared cooldown, rejects queued `rejectOnCooldown` waiters and returns the deadline. |
| `deferUntil`, `succeeded`, `cooldownUntil`, `cooldownRemainingMs`, `pendingCount`, `rateLimitRevision` | same | Extend the cooldown, reset fallback backoff after a success outside a cooldown, and read state. `rateLimitRevision` changes on every 429 so a batch can detect a revoked permit. |
| `RequestPriority`, `AdmissionOptions`, `AdmissionClock` | same | `'default' \| 'interactive' \| 'background'`; per-call `priority`, `signal`, `notBefore`, `rejectOnCooldown`; injectable clock, sleep, random, spacing and queue size. |
| `API_MAX_PENDING_ADMISSIONS`, `MAX_ADMISSION_SLEEP_MS`, `retryAfterDelayMs` | same | Queue cap of 256, with 16 places reserved for `interactive` work. Sleep clamp below Node's timer overflow. Strict `Retry-After` parser that returns `null` for malformed or overflowing values. |
| `BaseAdapter` | [`BaseAdapter.ts`](../../src/main/services/adapters/BaseAdapter.ts) | Abstract base for both adapters. `rawRequest` acquires admission per attempt, re-waits if a cooldown landed after the permit, sets a 15 s timeout and `redirect: 'error'`, and retries a 429 at most three times. |
| `request(url, schema, init, options)` | same | `rawRequest` plus interpretation: 401 and 403 → `AuthError`, other non-2xx → `NetworkError`, then JSON and Zod validation. The circuit opens after three straight failures for 60 s and refuses with `CircuitOpenError`; `onCircuitOpened()` runs once per opening (both adapters log it); `resetCircuit()` serves interactive login. |
| `AdapterRequestOptions`, `RequestInitSource` | same | `priority`, `signal`, `lease`, `retry: 'bounded' \| 'none'`, `recordCircuitFailure`, `ignoreOpenCircuit`, `beforeDispatch`. `ignoreOpenCircuit` sends through an open circuit; only the two sign-in status checks set it, so a paused platform cannot hide a session that ended. `retry: 'none'` sends one request, stops at a cooldown and fails on a newer 429. A function init is read after admission. |
| `recordCircuitFailure: 'auth'` | same | Counts only 401/403 answers toward the circuit. VRChat world and group lookups use it: a missing or unreadable item is an ordinary answer. |
| `RequestLease`, `AvatarRequestLease`, `assertRequestLease` | [`RequestLease.ts`](../../src/main/services/adapters/RequestLease.ts) | Main-only operation ownership (`generation`, `signal`, `isCurrent()`). `AvatarRequestLease.getCookie()` reads the VRChat cookie only after admission. `assertRequestLease` throws `RequestCancelledError` when stale. |
| `AuthError`, `AuthSessionPendingError`, `RateLimitError`, `NetworkError`, `CircuitOpenError`, `HttpStatusError`, `isNotFoundStatus`, `RequestCancelledError`, `RequestQueueFullError`, `signInFailure` | [`errors.ts`](../../src/main/services/adapters/errors.ts) | Typed adapter failures. `AuthError` carries the HTTP status. `CircuitOpenError` is the `NetworkError` for a request refused while the circuit is open (nothing was sent); `get-friends` reports it as `rate_limited`, so the window waits instead of retrying. `HttpStatusError` is the `NetworkError` for any other error status and carries it too; `isNotFoundStatus` finds a 404 in one, directly or as a ChilloutVR error's cause. `AuthSessionPendingError` means the session is not durably saved yet. `RateLimitError` carries `retryAfterMs` for main only. `signInFailure(error)` is the code a failed sign-in request reports: `rate_limited` for a `RateLimitError`, else `network_error`. |
| `CVRAuthError`, `CVRRateLimitError`, `CVRNetworkError` | same | ChilloutVR subclasses of the same errors. |

`CvrApiClient` sets `forbiddenOpensCircuit = false`: a ChilloutVR 403 can be a per-resource denial, so it never opens the circuit, and the adapter confirms the session with at most one key reauth.

## Adapter implementations and shared building blocks

The adapter classes (`VrcAdapter`, `CvrAdapter`), their API clients, credential stores and live wiring, the shared `ReconnectingPipeline` and `RosterRefresh`, and the credential guards are catalogued in [section 6](6-main-process.md#6-main-process).
