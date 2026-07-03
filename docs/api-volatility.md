# VRX — API Volatile-Surface Registry

> **Companion to [`docs/api-policy.md`](./api-policy.md).**
>
> Both the VRChat and ChilloutVR APIs are **unofficial and undocumented**. They drift without notice. This registry catalogs the API surfaces VRX depends on and documents how VRX degrades gracefully when they change.

## Introduction

VRX relies on two unofficial, undocumented APIs:
- **VRChat** (`https://api.vrchat.cloud/api/1`) — endpoint-level documentation exists in community wikis; official schema is absent.
- **ChilloutVR** (`https://api.abinteractive.net/1`) — no public documentation; reverse-engineered from community libraries and live observation.

Both APIs are subject to **breaking changes without warning**. This document enumerates the critical surfaces and VRX's resilience strategy.

**Related:** [`docs/api-policy.md`](./api-policy.md) documents rate-limit etiquette and the broader compliance posture; see that doc for the User-Agent policy, backoff strategy, and "no mass actions" rules.

---

## Volatile Surfaces at a Glance

| Endpoint / Field | What VRX uses it for | Verification | Degradation if changed |
|---|---|---|---|
| `GET /auth/user` (auth branch) | 2FA detection, user ID, display name | 🟡 Login branch verified; the VRX-173 reprompt branch (200+`requiresTwoFactorAuth` on a live session with expired 2FA cookie, and verify accepting a stale `twoFactorAuth` part in the Cookie header) matches VRChat web-client behavior but is mock-verified only — confirm on the owner's first live reprompt | `requiresTwoFactorAuth` on a live session → `needs-2fa` reprompt (code only, no password — VRX-173); if the API 401s instead, behavior degrades to today's full re-login (safe); unknown shape → treats as unauthenticated |
| `GET /auth/user` (success branch) | User ID, display name, presence buckets | ✅ Verified | Missing fields → partial login; empty buckets → all friends appear offline |
| `GET /auth/user/friends` (paginated) | Friend list, status, avatar, trust tags | 🟡 Verified endpoint, field drift observed | Unknown fields ignored; unknown status → `'online'`; empty tags → `'visitor'` trust |
| `/auth/user/friends` — `status` string | User status pill (join-me, ask-me, busy, etc.) | ✅ Verified | Unknown string → defaults to `'online'` (generic green pill) |
| `/auth/user/friends` — `tags` array | Trust rank (visitor, new, user, known, trusted, nuisance) | ✅ Verified mapping, field names | Unknown tags ignored; no match → `'visitor'` |
| `instanceId` / location string | Instance access type (public, friends, invite, group, etc.) | ✅ Verified tag grammar | Unknown tags → `'public'` (most open); unknown access type → most restrictive default |
| `GET /instances/{worldId}:{instanceId}` | Instance details (capacity, player count, closed status) | 🟡 Endpoint verified, schema drift possible | Missing fields → defaults or skipped (non-critical for UI) |
| `GET /worlds/{worldId}` | World name, description, thumbnail, capacity | 🟡 Endpoint verified, field drift observed | Missing name → blank; missing thumbnail → placeholder; missing capacity → unknown |
| `POST /auth/twofactorauth/{type}/verify` | 2FA code verification response shape | ✅ Verified | Unexpected `verified` value → login fails (safe default) |
| `GET /users/{userId}` | User profile (used for bulk enrichment) | 🟡 Endpoint verified, rarely called | Missing fields → partial user data; non-critical for presence UI |
| **Pipeline WS** `wss://pipeline.vrchat.cloud/?authToken=…` | Real-time friend events: `{type, content}` envelope with DOUBLE-ENCODED content; friend-online/active/offline/location/add/delete/update types; `GET /auth` token exchange | 🟡 Wire format verified vs community docs + VRChat's dev blog; mock-verified in code (VRX-146) — confirm event shapes on first live session | Unknown event types → logged + ignored; malformed frames dropped; undecodable content dropped; connect failure → backoff + retry, presence degrades to the slow REST reconcile (VRX-22) |
| **CVR `POST /users/auth`** | Login response (username, accessKey, userId, avatar, home world) | 🟡 Endpoint verified, schema drift possible | Missing accessKey → login fails; missing userId → non-functional |
| **CVR data envelope** | `{message: string, data: T}` wrapper on all responses | ✅ Verified | Unexpected shape → Zod validation fails; entire request treated as failed |
| **CVR `instanceSettingPrivacy`** | Instance access level (public, friends, invite, etc.) | 🟡 6 values verified, 4 missing from live capture | Unknown value → MOST RESTRICTIVE access (`owner-must-invite`) via `parseCvrPrivacy` (VRX-147) |
| **CVR WS** `wss://api.chilloutvr.net/1/users/ws` | Real-time friend presence: header auth on upgrade; `{ResponseType, Data}` clean-JSON envelope; ONLINE_FRIENDS full-online-set snapshots; outgoing `{RequestType, Data}` actions | 🟡 Event model verified vs CVRX + chilloutvr_rs source (2026-06-02); envelope CASING and outgoing Data shapes are mock-verified — confirm on first live CVR session | Unknown ResponseTypes → logged + ignored; malformed entries skipped per-entry; both envelope casings accepted; connect failure → backoff + retry |

---

## Detailed Volatile Surfaces

### VRChat Authentication (`/auth/user`)

**Endpoint:** `GET /auth/user` with HTTP Basic auth (username:password in base64)

**What VRX depends on:**
- 2FA detection: `requiresTwoFactorAuth: string[]` (when 2FA is required, _instead_ of the success response)
- User ID + display name: `id: string`, `displayName: string` (on successful login)
- Presence buckets: `onlineFriends: string[]`, `activeFriends: string[]`, `offlineFriends: string[]` (friend IDs grouped by presence state)

**Verification:** ✅ Verified in VRX code and live against production API (VRX-42, VRX-43).

**Degradation if changed:**
- **Missing 2FA shape:** If `requiresTwoFactorAuth` becomes a different field name or structure, login will not detect 2FA requirement. VRX treats this as a failed 2FA and prompts again. Safe fallback: user re-tries with the code.
- **Missing presence buckets:** Zod schema `.default([])` ensures empty arrays are substituted. All friends appear offline until a WebSocket `friend-online` event updates them. UI degrades to "loading" state until real-time data arrives.
- **Missing `id` or `displayName`:** Zod validation fails; entire login fails with an auth error. Safe: user is prompted to log in again.

**Code reference:** `/src/main/services/adapters/VrcAdapter.ts` (lines 28–31: schemas with defensive `.object()` and no required-field gotchas).

---

### VRChat Friend List (`GET /auth/user/friends`)

**Endpoint:** `GET /auth/user/friends?offset=0&n=100&offline=false` (paginated, online + offline passes)

**What VRX depends on:**
- Friend ID: `id: string` (used as platform identifier and for membership in presence buckets)
- Display name: `displayName: string` (shown in friend row)
- Avatar thumbnail: `currentAvatarThumbnailImageUrl: string | null | undefined` (friend avatar in list)
- Status string: `status: string | null | undefined` (e.g., `"join me"`, `"active"`, `"busy"`, `"offline"`)
- Status description: `statusDescription: string | null | undefined` (custom status text ≤32 chars)
- Trust tags: `tags: string[]` (e.g., `["system_trust_known"]`, `["system_probable_troll"]`, empty → no tag)

**Verification:** 🟡 Endpoint verified; field drift observed in past updates (e.g., avatar field handling). Community confirms pagination, offline flag, and tag semantics.

**Degradation if changed:**
- **Unknown `status` value (e.g., `"idle"` added by API):** Defensive mapping in `parsePresence()` falls back to `'online'` (generic green pill). User sees a valid status rather than a crash or unknown value. See `/src/main/services/adapters/vrchat/parsePresence.ts` lines 58–64.
- **Missing `status` field:** Defaults to `null` (no status pill). UI renders as offline/neutral. Non-breaking.
- **New trust tags (e.g., `"system_trust_troll"`):** `parseTrustRank()` ignores unknown tags and returns `'visitor'` (safe default, most permissive). Existing tags continue to work. See `/src/main/services/adapters/vrchat/parseTrustRank.ts` lines 40–48.
- **Empty or null `tags` array:** Defaults to `'visitor'` rank. Safe; user is rendered as a fresh visitor, not as an error.
- **Missing avatar URL:** Zod `.nullable().optional()` defaults to `null`; UI renders a placeholder. Non-breaking.
- **New optional fields added by API:** Zod ignores them. VRX silently accepts and proceeds. Safe tolerance for benign drift.
- **A malformed friend record (breaking drift on one entry):** Skipped and counted (`skippedRecords`); the other records on the page survive. Records are validated individually, not as an all-or-nothing page (2026-07 audit W4).
- **A failed page fetch (network blip, transient 5xx):** Counted (`failedPages`) and the window skipped; the pass continues to the next page, giving up only after 3 consecutive failures. If NOTHING was fetched and anything failed or drifted, `getFriends` throws instead of returning a misleading empty list.

**Code references:**
- `/src/main/services/adapters/vrchat/fetchFriends.ts` (`rawFriendSchema` with `.default([])`/`.nullable().optional()`; per-record `safeParse` skip+count; `MAX_CONSECUTIVE_PAGE_FAILURES`)
- `/src/main/services/adapters/vrchat/parsePresence.ts` (unknown status mapping)
- `/src/main/services/adapters/vrchat/parseTrustRank.ts` (unknown tag handling)

---

### VRChat Instance Access Type (from location/instanceId)

**Endpoint:** Data extracted from the `location` field in friend objects or instance details (not an endpoint itself).

**Format:** `wrld_<worldId>:<nonce>[~tag(value)]...` or empty/`private`/`offline`/`traveling`.

**What VRX depends on:**
- Access tags: `~hidden(usr_x)` (Friends+), `~friends(usr_x)` (Friends), `~private(usr_x)` (Invite), `~canRequestInvite` (Invite+)
- Group tags: `~group(grp_x)~groupAccessType(public|plus|members)` (group instance variants)
- Absence of tags → public instance

**Verification:** ✅ Verified. Tag names and semantics confirmed in VRX-45 implementation and VRCX source.

**Degradation if changed:**
- **New access tag added (e.g., `~restricted(…)`):** `parseInstanceType()` does not recognize it; falls through to `'public'` (line 73). Rendered as the most open type; user can attempt to join. Safe fallback for unknown future tags.
- **Tag name changes (e.g., `~hidden` becomes `~friends-plus`):** Old tag is not recognized; instance is rendered as public. Worst case: user sees a public instance but it's actually restricted; join attempt fails gracefully at the game level (not VRX's responsibility).
- **Missing or malformed location string:** Returns `'public'` (line 52). Non-breaking.

**Code reference:** `/src/main/services/adapters/vrchat/parseInstanceType.ts` (full implementation, lines 51–74; every unknown tag degrades to public or most-restrictive default).

---

### VRChat Trust Rank (from user tags)

**Endpoint:** Field `tags: string[]` from user objects.

**What VRX depends on:**
- Rank tags: `system_trust_basic` → new, `system_trust_known` → user, `system_trust_trusted` → known, `system_trust_veteran` → trusted
- Nuisance flag: `system_probable_troll` → nuisance (separate from rank hierarchy)
- Absence of tags → visitor (default)

**Verification:** ✅ Verified. Tag semantics confirmed in VRX-49 implementation.

**Degradation if changed:**
- **New trust tag (e.g., `system_trust_elder`):** Not in the rank map; falls through to `'visitor'`. User is rendered at the lowest trust tier. Safe; does not crash.
- **Nuisance tag is renamed (e.g., `system_account_flagged`):** New tag is not recognized as nuisance; user is rendered with a normal rank (depends on other tags). Worst case: a flagged user shows as trusted if other tags are present. Non-critical; nuisance is a social signal, not a security boundary.
- **Tag is removed from API:** Empty `tags` array defaults to `'visitor'`. Non-breaking.

**Code reference:** `/src/main/services/adapters/vrchat/parseTrustRank.ts` (lines 18–63; hierarchical fallback to visitor).

---

### VRChat 2FA Verification Response

**Endpoint:** `POST /auth/twofactorauth/totp/verify` or `/emailotp/verify`

**What VRX depends on:**
- Success signal: `verified: boolean` (true = verified; false or absent = verification failed)

**Verification:** ✅ Verified in VRX-42 code and live testing.

**Degradation if changed:**
- **`verified` field is renamed or removed:** Zod schema expects `verified: boolean` (line 33 in `VrcAdapter.ts`). If the field is missing or the response shape changes entirely, validation fails and login fails. Safe: user is prompted to re-authenticate.
- **Unexpected `verified` value (e.g., `"pending"` or `null`):** Zod coerces to the nearest type; if not boolean, validation fails. Safe.

**Code reference:** `/src/main/services/adapters/VrcAdapter.ts` (line 33: `twoFactorVerifySchema`).

---

### VRChat World Metadata (`GET /worlds/{worldId}`)

**Endpoint:** `GET /worlds/{worldId}`

**What VRX depends on:**
- World name: `name: string`
- World thumbnail: `imageUrl: string`
- Capacity: `capacity: int`
- Publish status: to detect if a world is still public

**Verification:** 🟡 Endpoint verified; field names and presence subject to drift.

**Degradation if changed:**
- **Missing `name`:** The one critical field — the whole world resolves to `null` (nothing to show without a name); friends still render with `worldName: null`. Non-breaking.
- **Missing or wrong-typed `thumbnailImageUrl` / `capacity` / `shortName`:** Each enrichment field independently degrades to `null` via Zod `.catch(null)` — one drifted field never nulls the rest of the world (2026-07 audit W4).
- **New metadata fields added (e.g., `averageRating`):** Zod ignores them. Non-breaking.

**Code reference:** `/src/main/services/adapters/vrchat/WorldResolver.ts` (`WorldApiSchema`: only `name` required; enrichment fields use `.catch(null)`).

---

### VRChat Instance Details (`GET /instances/{worldId}:{instanceId}`)

**Endpoint:** `GET /instances/{worldId}:{instanceId}`

**What VRX depends on:**
- Player count: `n_users: int` or similar
- Capacity: `capacity: int`
- Closed status: `closedAt: string | null` (if present, instance is no longer joinable)

**Verification:** 🟡 Endpoint verified; response shape subject to drift.

**Degradation if changed:**
- **Missing player count or capacity:** UI renders "unknown players". Non-critical.
- **New or renamed fields:** Zod ignores. Non-breaking.
- **`closedAt` semantics change:** VRX checks for presence. If null → open; if set → closed. Backward-compatible.

**Code reference:** BaseAdapter request validation; specific schemas TBD (not yet fully implemented in current code).

---

### ChilloutVR Authentication (`POST /users/auth`)

**Endpoint:** `POST /users/auth` with JSON body `{AuthType, Username, Password}`

**What VRX depends on:**
- Access key: `accessKey: string` (session token; reused on every authenticated request)
- User ID: `userId: string` (platform identifier)
- Username: `username: string` (for re-authentication)
- Current avatar: `currentAvatar: string` (URI or ID)
- Current home world: `currentHomeWorld: string` (world URI or ID)

**Verification:** 🟡 Endpoint verified; response shape from reverse-engineering and live observation.

**Degradation if changed:**
- **Missing `accessKey`:** Zod validation fails (required field). Login fails. Safe: user is prompted to re-authenticate.
- **Missing `userId`:** Zod validation fails. Login fails. Safe.
- **New response fields (e.g., `friendCount`):** Zod ignores. Non-breaking.
- **Field name changes (e.g., `access_key` instead of `accessKey`):** Validation fails. Login fails. Requires code update.

**Code reference:** `/src/main/services/adapters/CvrApiClient.ts` (lines 16–25: `cvrUserAuthSchema`).

---

### ChilloutVR Data Envelope

**Endpoint:** All authenticated CVR endpoints return `{message: string, data: T}`.

**What VRX depends on:**
- Message: `message: string` (status/debug message)
- Data: `data: T` (the actual response payload, validated against an inner schema)

**Verification:** ✅ Verified in implementation and confirmed across multiple endpoints.

**Degradation if changed:**
- **Envelope structure changes (e.g., `{status, result}` instead of `{message, data}`):** All CVR requests fail validation. Entire adapter is broken until code is updated.
- **New or removed envelope fields:** Zod ignores extra fields; missing fields cause validation failure only if required (currently: none are strictly required beyond the two above). Non-breaking if only `data` structure changes.

**Code reference:** `/src/main/services/adapters/CvrApiClient.ts` (lines 86–91: envelope validation).

---

### ChilloutVR Instance Privacy (`instanceSettingPrivacy`)

**Endpoint:** Present in user, instance, and friend response objects.

**What VRX depends on:**
- Privacy value: `instanceSettingPrivacy: string` (one of 10 known values mapping to VRX's privacy tiers)

**Known values (verified):**
- `"public"` → public
- `"friendsoffriends"` → friends-of-friends / extended
- `"friends"` → friends only
- `"group"` → group members only
- `"everyonecaninvite"` → public with invite
- `"ownermustinvite"` → invite only

**Unknown values (observed but not yet mapped):** 4 additional values exist but have not been captured in live API responses (VRX-130).

**Verification:** 🟡 6 values verified via reverse-eng and testing; 4 values still unverified.

**Degradation if changed:**
- **Unknown privacy value encountered:** VRX logs the unknown value and renders it as "unknown privacy" or a neutral icon. Non-breaking; user can still see the instance exists.
- **New privacy type added by API:** Treated as unknown. Non-breaking until mapping is needed for correct UI display.
- **Value name changes (e.g., `"public"` → `"public_world"`):** Treated as unknown. Non-breaking but semantic drift may occur.

**Code reference:** Mapping logic TBD (not yet fully integrated; flagged in VRX-130).

---

## VRX's Resilience Strategy

### 1. Defensive Zod Schemas

Every API response is validated against a Zod schema **before** being used. Schemas are designed to tolerate benign drift:

- **`.nullable()`** on fields that may be `null` (avatar URL, status description)
- **`.optional()`** on fields that may be absent (new fields added by API)
- **`.default([])` or `.default('')`** on fields that should never crash if missing (tags, description)
- **Unions and string literals** for known enum values (e.g., `status` field); unknown values fall through to a safe default

### 2. Unknown Enum Values → Safe Defaults

When an unknown enum value is encountered:
- **Unknown `status` string** → `'online'` (generic green pill; never crashes)
- **Unknown instance-access tag** → `'public'` (most open interpretation; join-attempt may fail gracefully at game level)
- **Unknown trust tag** → ignored; final rank is either a known tag or `'visitor'` (never crashes)
- **Unknown CVR privacy value** → rendered as "unknown" (non-critical for core UI)

### 3. Graceful Degradation on Parse Failure

If a Zod schema validation fails on a single response:
- **Paginated friend fetch:** The failed page is skipped; subsequent pages continue. VRX returns all friends collected so far + a failure count for logging.
- **World metadata fetch:** Missing fields → defaults (blank name, placeholder image, unknown capacity). Non-critical data is rendered as "unknown".
- **Login/auth responses:** If the response shape is unexpected, the entire login fails and the user is re-prompted.

### 4. Single-Field Tolerance

Zod tolerance is field-level, not page-level:
- A friend object with an unknown `status` value is still parsed; only that field uses the safe default.
- A world object with a missing `capacity` field is still parsed; only that field is blank.
- A parse failure on one optional field does not kill the whole response.

---

## Known Volatile Areas (Watch List)

### VRChat
- **Presence bucket structure:** The `onlineFriends`, `activeFriends`, `offlineFriends` arrays in `/auth/user` are core to the two-axis presence model (VRX-44). If the API removes or renames these, presence parsing breaks and requires a code update.
- **Status enum values:** New values like `"idle"` or `"in-flight"` may be added. VRX degrades to `'online'`, which is safe but loses semantic precision.
- **Trust tag namespace:** If VRChat phases out visible trust (as suggested in API research), the `tags` field may be deprecated or replaced. VRX currently falls back to `'visitor'` if tags are missing; this is safe but not future-proof.

### ChilloutVR
- **Data envelope structure:** All CVR endpoints depend on `{message, data}`. If this changes, all authenticated requests break.
- **Missing `instanceSettingPrivacy` mapping:** 4 of 10 known values are still unverified (VRX-130). When captured, the mapping will be completed and this watch item will close.
- **Access key lifetime & refresh:** No refresh mechanism is documented. If access keys expire, VRX must detect expiry (via 401 or similar) and trigger re-authentication. Currently handled by treating a 401 as auth failure; safe but not optimized.

---

## Future Work

### Active Breakage Detection

Currently, VRX degrades gracefully on known schema drift but does not **detect or alert** when an API change occurs. Future work (post-v1.0):
- **Telemetry:** Track failed parses and unknown enum values; alert on novel drift.
- **API version pinning:** Confirm which API versions VRX supports (if versioning exists).
- **Community feedback loop:** Integrate user-reported breaking changes (from GitHub Issues) into the degradation logic.

### Complete CVR Privacy Mapping

Capture the 4 unknown `instanceSettingPrivacy` values from live CVR API responses and map them to VRX privacy tiers (VRX-130).

### Upstream Monitoring

Monitor VRCX, CVRX, and official community changelogs for breaking-change announcements. Update this registry and code accordingly.

---

## References

- **VRChat API:** Community-maintained `vrchatapi` repository ([GitHub](https://github.com/vrchatapi/api)) — last checked 2026.
- **ChilloutVR API:** Reverse-engineered from `chilloutvr_rs` Rust crate ([archived repo](https://github.com/jaquadro/chilloutvr_rs)) and live API observation.
- **VRX Code:** See `/src/main/services/adapters/` for all adapter and parser implementations.
- **Compliance Policy:** [`docs/api-policy.md`](./api-policy.md) — rate limits, User-Agent, backoff, and etiquette rules.
