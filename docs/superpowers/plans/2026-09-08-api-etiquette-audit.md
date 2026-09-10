# Whole-app API etiquette audit

September 8, 2026. Audited commit `f910da981567d6d324af4fa67c0fa3a9e7c279ec`;
application source is unchanged from main `9dbac8b`. This is a source and
mock-transport audit, not a live traffic capture or a legal compliance opinion.
No real platform requests, credentials, game launch, session changes or screen
captures were used. No application code was changed.

## Verdict

September 9 continuation: the owner approved fixing A1–A5 and retaining
encrypted saved sessions without password persistence. The
[traffic-hardening plan](2026-09-09-api-traffic-hardening-plan.md) records the
implementation sequence and peer-app evidence. Saved-login policy ambiguity
is not a demonstrated violation requiring a redesign. CVR's missing disclaimer
remains separate work. The findings below describe the unchanged baseline.

Do not sign off the app as fully compliant or add Explore traffic yet. The main
REST dispatcher has useful protections, but API-backed images bypass its
cooldown, queued work can outlive its account session, and reconnect/retry
behavior can create avoidable traffic. There are also policy/disclosure gaps
that a request cap cannot resolve.

The earlier 16-requests-per-platform proposal is withdrawn from approval pending
these findings. It was an app design limit, not a platform-published allowance.
Fixing the transport gaps can reduce risk; no test can promise that a platform
will never rate-limit or moderate an unofficial client.

## Published rules checked

### VRChat

The official [Creator Guidelines, API Usage / Bots](https://hello.vrchat.com/creator-guidelines#api-usage--bots)
permit API applications subject to restrictions. They require metering,
caching, backoff, proper User-Agent identification and unsynchronized scheduled
traffic. They warn against continuing after 429, uploading assets for users,
and acting from a different user's device/IP. No universal numeric request
allowance appears in that section. The old community-library quotation about
one query per 60 seconds is not the current text on this official page.

The same page discourages requesting or storing login information, explicitly
including session tokens. Local encrypted storage does not establish an
exception. The broader [Terms, section 13](https://hello.vrchat.com/legal)
also restrict automated extraction and misuse. These are policy constraints,
not merely transport settings. Do not turn this audit into legal assurance.

### ChilloutVR

The official [Terms, version 2026-V10, section 8](https://docs.chilloutvr.net/official/legal/tos/#8-third-party-applications-and-sites)
permit third-party applications with the required application disclaimer:

> This application is not created by or affiliated with ChilloutVR or the ChilloutVR team in any way.

The terms prohibit bots, exploits, false affiliation and abuse. I found no
general numerical REST quota in the official terms/docs checked. The documented
three-second limit for in-game pickup-marker details is a CCK rule, not a REST
quota for VRX. The terms' moderation definition of public rooms is broader than
Explore's approved Public/Group Public filter; it does not require expanding
that product filter.

The [XYVR maintainer's changelog](https://docs.hai-vr.dev/docs/xyvr/changelog)
reports switching to `api.chilloutvr.net` at a CVR team member's request. This is
first-hand evidence about XYVR, not a published universal migration deadline.
VRX still uses `api.abinteractive.net/1` for normal REST. Record this discrepancy
for compatibility planning; do not silently switch authentication hosts based
only on another application's report.

## Current traffic inventory

| Path                                      | What initiates it                                                                | Protections and limits                                                                                 |
| ----------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| VRC authentication and session validation | Login, restore, auth invalidation                                                | Main-only adapter; identified User-Agent; shared adapter dispatcher                                    |
| VRC roster                                | Initial social-view load, manual refresh, reconnect, selected reconcile interval | `/auth/user` then online/offline pages; 5,000-record cap; request pacing; partial-result handling      |
| VRC world/group metadata                  | Roster and friend WebSocket enrichment                                           | Dedupe/caches; up to ten workers for each metadata kind, serialized at the HTTP dispatcher             |
| CVR authentication and roster             | Login/restore, initial query, name warming, reconnect/roster events, reconcile   | `/users/auth` and `/friends`; same adapter dispatcher                                                  |
| CVR room metadata                         | Friend snapshot enrichment and room details                                      | Encoded `/instances/{id}`, cache/dedupe and account-generation result fences                           |
| API-backed images                         | Visible image requests through the main image bridge                             | Separate serial one-second API-host lane, not the REST queue or cooldown                               |
| CDN images                                | Image bridge and allowed redirect from the VRC API                               | Four concurrent fetch slots, URL/size/MIME restrictions, cache/dedupe; no general 429 cooldown         |
| VRC self-invite / game launch             | Explicit UI action                                                               | Main target authority, settings, cooldown, URL allowlist; self-invite is a POST, launch is a deep link |
| Live social state                         | One shared socket per platform adapter                                           | Account lifecycle fencing, identifying headers, 15-second handshake timeout, reconnect backoff         |
| Updater / local status                    | Update controls and local UI refresh                                             | Updater is separate GitHub/release traffic; TopBar reads a local snapshot, not game APIs               |

Production network entry points were searched across `src`. Platform HTTP is
in `BaseAdapter.ts` and `avatarCache.ts`; socket construction is in
`socketFactory.ts`. No direct renderer platform HTTP was found. Dormant CVR
socket methods for invites/blocks are not wired to current app call sites;
this audit found no mass-action loop.

## Findings and evidence

### A1. API-backed images ignore host cooldown and split the rate limit

High confidence, reproduced. `src/main/services/avatarCache.ts:210` selects its
own API lane. Its fetch at line 223 never consults the adapter cooldown.
`readImageBody` at line 267 handles a 429 as an ordinary failed image, without
reading Retry-After. The negative cache is per URL, so it does not stop the next
distinct image. Its pacing state at line 336 is separate from
`src/main/services/adapters/BaseAdapter.ts:103` and `:309`.

With the actual source classes and mocked fetch, one REST and one API-host
image call dispatched 6–7 ms apart. After a mock image 429 with Retry-After 60,
the next distinct image dispatched in about 1.1 seconds. Both target the same
API hostname. This breaks VRX's claimed combined one-per-second ceiling and
fails to respect the simulated server cooldown. It does not establish an
undocumented vendor numerical threshold.

Required correction: one main-owned budget/cooldown for all requests to a
platform API host, including authenticated image redirects. Keep CDN body
transfers bounded separately, but honor their own rate-limit responses too.
Do not forward cookies to CDN destinations.

### A2. Queued requests can send the previous session after logout

High confidence, reproduced at the transport boundary.
`VrcApiClient.ts:61` builds the headers before `BaseAdapter.ts:103` waits for a
slot. Clearing the adapter cookie does not erase that queued header object.
The mock queued a read, cleared the cookie, released the queue and observed
the previous synthetic cookie being sent. No actual cookie was read.

This is old-session work continuing, not proof that already queued requests
use the replacement account's cookie. Adapter result-generation fences protect
cache/UI writes, but do not cancel a fetch before dispatch. CVR has the same
header-capture structure. Metadata workers check generation before resolving,
which bounds new work after a switch, but does not cancel work already waiting.

Required correction: bind queued requests to a session lease and cancel or
reject obsolete work immediately before dispatch and retry. Bound queued work.
Do not remove the existing result-generation fences or change credential
persistence without separate review.

### A3. Rate-limit exhaustion does not stop VRC roster traversal

High confidence, reproduced in the real paginator with a mock fetcher.
`vrchat/fetchFriends.ts:163` distinguishes auth errors but not RateLimitError.
After the adapter exhausts its retries, it treats that failure as a bad page,
continues to later offsets and then the offline pass.

With `/auth/user` successful and every page returning a RateLimitError, the
paginator attempted three online and three offline pages. These are six
logical page requests, not six measured wire calls. The adapter can try each
logical request up to four times. The renderer's general three-retry policy
can restart a failed roster because its no-retry exception only recognizes
local IPC `rate_limited`, not this remote rate-limit failure. Shared adapter
cooldown still spaces those requests; this is retry amplification, not proof
that the REST dispatcher ignores Retry-After.

Required correction: preserve a remote rate-limit result through pagination,
IPC and queries; end the batch and suppress outer automatic retries during
cooldown. Keep partial good data. Test wire attempts across all retry layers,
not just one request helper.

### A4. Successful-but-short socket opens reset backoff immediately

High confidence, reproduced with fake sockets.
`ReconnectingPipeline.ts:197` resets failure count on every open. A connection
that opens and immediately closes three times produced delay requests
`[1000, 1000, 1000]` with jitter fixed to zero. Failures before open do use
exponential backoff, but this flapping case never escalates. Each live edge can
also invalidate the friends query at `useLiveFriendEvents.ts:94`.

The socket abstraction at `ReconnectingPipeline.ts:31` also omits the upgrade
HTTP response and Retry-After headers. An upgrade 429 cannot currently select
a server-requested delay. No live upgrade 429 was observed in this audit.

Required correction: reset backoff only after an established healthy interval,
honor handshake rate-limit responses and coalesce reconnect-driven REST work.
Do not add a second socket for Explore.

### A5. CVR initial name warming duplicates the renderer roster request

Static call-chain evidence. `CvrAdapter.ts:561` invokes `warmFriendNames`, which
calls getFriends at line 816. The same live event invalidates the renderer query
at `useLiveFriendEvents.ts:96`; `ipc/friends.ts:22` independently calls getFriends.
`CvrAdapter.ts:410` protects overlapping cache writes but does not share the
HTTP promise.

The name-warm guard at `CvrAdapter.ts:810` stays set after success. Therefore this
is an initial/session-start overlap, or a later retry after failed warming,
not a guaranteed double fetch on every reconnect. Main-level roster dedupe
would remove it while keeping names available to the socket consumer.

### A6. Full policy compliance cannot be inferred from secure local login

`LoginScreen.tsx:92` presents a credential form;
`VrcAdapter.ts:206` accepts login credentials;
`VrcAdapter.ts:1276` persists the session;
`services/credentials.ts:88` encrypts it with safeStorage. This reduces exposure
but does not resolve the published VRChat credential guidance noted above.
No applicable exemption was established. Do not remove login or stored sessions
silently, and do not claim encryption alone makes this policy-compliant.

The exact CVR application disclaimer was not found in `src`, README or API
policy. Existing generic non-affiliation text is not the required sentence.
An approved visible placement, such as Accounts/About, should carry it and
preserve localization parity. This is a disclosure change, not a traffic fix.

### A7. Existing documentation overstates behavior

README says no polling and API policy says polling is avoided entirely.
`queries/friends.ts:66` performs a jittered periodic REST reconcile at the saved
5/10/30-minute interval, with manual disabling the timer. The default is five
minutes. That is slow polling used as a recovery mechanism, while WebSockets
remain the live path. Jitter avoids synchronized clock-bound spikes; it does
not turn polling into something else. This is not, by itself, evidence of a
vendor-rule violation. Correct the documentation rather than deleting a
previously approved recovery feature without a decision.

## What WebSockets can do for Explore

The [VRC community's protocol reference](https://vrchat.community/websocket)
describes account/friend, notification, group and instance-queue events, not a
global active-world/public-room occupancy feed. VRX currently consumes the friend
subset in `vrchat/VrcPipeline.ts:150`.

The pinned [CVRX socket implementation](https://github.com/AstroDogeDX/CVRX/blob/f7b3d197c0960238d29facb41a9d706fc44eaa4e/server/api_cvr_ws.js)
describes online friends, roster changes, invites and account notifications.
VRX maps ONLINE_FRIENDS and FRIEND_LIST_UPDATED in `cvr/CvrPipeline.ts:280`.
I found no public-world subscription in either protocol inspected. This is
bounded evidence, not a claim that no future endpoint can exist.

Keep the existing sockets for live friends, account state and reconnection
recovery. They avoid frequent social REST requests, but a friend's location
does not prove public access or a world's total public occupancy. Reusing it
as Explore's directory would change the approved meaning and miss strangers'
rooms. Public discovery still needs paced, cached category/world/room REST.
Do not refresh Explore for every friend event or socket reconnect. A stale
socket watchdog may help recovery, but must not become a new polling stream.

## Verification and limits

Five offline reproductions ran against bundled imports of the unchanged
application source. Fetch and sockets were replaced with synthetic transports.
The last run exited zero and printed:

```text
split-api-lanes: 6 ms between REST and API-host image requests
image-429-next-url: 1100 ms, despite Retry-After: 60
queued-header-after-cookie-clear: previous synthetic cookie sent
open-close-flapping: retry delays [1000, 1000, 1000]
paginator-after-rate-limit: three online and three offline logical attempts
AUDIT_FINDINGS_REPRODUCED_WITH_MOCK_TRANSPORTS_ONLY
```

Disposable reproducer: `/private/tmp/vrx-api-audit.RGICts/probe.cjs`. It reads
current source and uses the existing source checkout's esbuild dependency.
One initial harness run failed because its in-memory CommonJS filename was
unset; that harness error was corrected before the successful runs. No app
fix or full test-suite pass is claimed. The durable evidence is the conditions
and results above; temp-file availability is not a prerequisite for remediation.

Two read-only Codex investigations supplied the HTTP and WebSocket inventories.
The driver inspected the relevant code and corrected cookie-timing and CVR
warming overstatements before recording these findings. These are same-lineage
investigations, not independent external compliance approval. The debugging
workflow required offline reproductions before proposing transport corrections.

Not tested: live server thresholds, actual account moderation, full production
traffic over time, socket upgrade 429s, platform-specific heartbeat failures,
or any other client sharing the user's account/IP. Do not infer those outcomes.

## Next work and authority

Recommend a separate app-wide transport-correction pass before Explore, covering
A1–A5 with mocked regressions, existing auth/social/launch tests and critical-risk
review. Then recalculate the Explore budget within the single app-wide budget.
Keep the agreed Explore UI and CVR full-room behavior unchanged.

The owner subsequently chose to retain encrypted local sessions without stored
passwords, informed by VRCX/CVRX practice and the limits of that evidence.
Reducing traffic does not establish whole-app policy compliance or a
vendor-approved authentication basis. No login redesign is required by the
evidence collected. Removing authentication would remove existing user features
and is not authorized. The missing CVR disclaimer still needs approved visible
placement. Neither this audit nor the continuation authorizes a new live probe,
merge or release.

This pass records findings and marks the Explore handoff on hold. Runtime
contracts, design artifacts, settings, API policy, README and changelog remain
unchanged; their inaccurate claims and required corrections are listed above.
No new directory/DOX boundary was introduced. No tracker/PR was changed.
