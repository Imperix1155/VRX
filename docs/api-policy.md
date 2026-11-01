# API policy

VRX is an unofficial desktop companion for VRChat and ChilloutVR. It is not
affiliated with, endorsed by, or approved by VRChat or ChilloutVR. Neither
platform publishes the APIs VRX uses. They can change,
throttle, or disappear without notice, and features built on them can break
without warning.

ChilloutVR's terms (§8, third-party applications) require apps that use its
services to show: "This application is not created by or affiliated with
ChilloutVR or the ChilloutVR team in any way." VRX shows that sentence word for
word in Settings → About → Legal (`settings.legal.chilloutvr`), next to a
matching VRChat sentence, and the README carries it too. The login screen,
Settings → Accounts and the welcome setup show a one-line notice
(`shell.unofficialNotice`) that names the VRChat team and the ChilloutVR team.
Keep the required sentence word for word, as its own sentence; a test guards
it. App text, README and docs name the platforms only, never the companies
that run them.

This page states how VRX uses those APIs and the limits it holds itself to. The
code is the source of truth. Observed response shapes and uncertain assumptions
live in [API volatility](./api-volatility.md).

## Scope

The policy covers every request VRX's main process sends to either platform:
REST calls, WebSockets, and images fetched from platform hosts. The renderer
never talks to a platform directly. App updates come from GitHub Releases and
are outside the platform queues.

## What VRX does

VRX signs in as the user, on the user's own machine, and reads that user's own
social data: friends, presence, locations, instance details, and public worlds
for Explore. On the Avatars page it reads the user's own uploaded avatars and
the one they wear, and switches avatar when the user presses Wear. The
Dashboard reads only the worn avatar. On request it also reads a person's
profile, searches people and worlds by name, lists New and Recently updated
worlds, the user's own groups, and each platform's player count (see
[Search, profile and group limits](#search-profile-and-group-limits)). It launches
the game through local URL schemes, or, when the game is already open, hands
the Join to that copy (see
[Joining a game that is already open](#joining-a-game-that-is-already-open)).

| Area                  | VRChat                                                                                                                                                                         | ChilloutVR                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| REST base             | `https://api.vrchat.cloud/api/1`                                                                                                                                               | `https://api.abinteractive.net/1`; Explore reads use `https://api.chilloutvr.net`               |
| Live presence         | VRChat Pipeline, `wss://pipeline.vrchat.cloud/`                                                                                                                                | `wss://api.chilloutvr.net/1/users/ws`                                                           |
| Socket auth           | `authToken` query value from `GET /auth`, falling back to the stored `auth` cookie                                                                                             | `Username` and `AccessKey` upgrade headers, the same headers REST uses                          |
| Socket traffic        | Receive-only                                                                                                                                                                   | Receive-only today; outgoing sender methods exist but nothing calls them                        |
| Roster read           | `GET /auth/user`, then `GET /auth/user/friends` pages of 100, online then offline                                                                                              | One `GET /friends`                                                                              |
| Metadata enrichment   | `GET /worlds/{id}` and `GET /groups/{id}`, cached 24 hours, also across launches (failures 60 seconds)                                                                         | `GET /instances/{id}`, cached 5 minutes (failures 60 seconds)                                   |
| Stored session        | The `auth` cookie, plus `twoFactorAuth` when issued                                                                                                                            | Username and access key                                                                         |
| Avatar reads          | `GET /avatars?user=me&releaseStatus=all`, pages of 100, at most 500 avatars; `GET /users/{me}/avatar`                                                                          | One `GET /avatars` (own uploads kept); `GET /users/{me}`; `GET /avatars/{id}` when details open |
| Community reads       | `GET /users/{id}`, `GET /users?search=`, `GET /worlds?search=`, world lists, `GET /users/{id}/groups`, `GET /visits`                                                           | `GET /users/{id}`, `GET /search/{text}`, world lists, `GET /groups`, `GET /public/userstats`    |
| Platform write action | Self-invite, `POST /invite/myself/to/{location}`: from the Join of a game that is already open, or for a non-public friend instance; avatar switch, `PUT /avatars/{id}/select` | Avatar switch, `GET /avatars/{id}/switchAvatar`                                                 |
| Join                  | Local `vrchat://launch` URL; no API call. With VRChat open: the same URL over VRChat's local URL pipe (Windows), else one self-invite                                          | Local `chilloutvr://instance/join` URL; no API call, also when the game is open                 |
| API-host images       | `api.vrchat.cloud` image hops share VRChat admission; results are kept on disk for 14 days                                                                                     | None; ChilloutVR images come from CDN hosts                                                     |

VRX never stores a password. A sign-in exchanges the password once for the
session material in the table, which [`credentials.ts`](../src/main/services/credentials.ts)
encrypts at rest. "Use my sign-in from this PC" reuses session material that
VRCX, the game, or CVRX already saved. VRX checks it with one sign-in request
(VRChat `GET /auth/user`, ChilloutVR `POST /users/auth` with `AuthType: 1`)
before it saves anything.

## What VRX refuses to do

- **No bots.** VRX does not automate social actions, run unattended, or act for
  anyone except the signed-in user.
- **No presence polling.** Live presence comes only from the two sockets above.
  VRX never polls a friend's status or location.
- **No answering for the user.** The Inbox lists invites, invite requests and
  friend requests that the sockets already deliver. It is view-only: no extra
  request reads them, and VRX never accepts, declines or replies. Hide only
  removes a row inside VRX.
- **No mass actions.** No bulk invites, friend requests, messages, or blocks.
  The only platform writes are one user-initiated VRChat self-invite at a time
  and one user-initiated avatar switch per platform at a time, to an avatar VRX
  listed for that signed-in account.
- **No avatar crawling.** VRX lists only the user's own uploads and the avatar
  they wear. It never searches other people's avatars or uses third-party
  avatar databases.
- **No people crawling.** Search sends one request per platform for each
  Enter, at most one every 2 seconds, and keeps 10 people and 10 worlds. Main
  reads a full profile only for a friend or someone a search just listed, so
  the renderer cannot walk arbitrary profiles.
- **No crawling.** VRChat roster pagination stops at 5,000 friends, and
  ChilloutVR returns its roster in one read. Explore stops at fixed budgets and
  reports incomplete coverage instead of reading further.
- **No VRCX or CVRX writes.** VRX never writes to VRCX, CVRX, or game folders.
  "Use my sign-in from this PC" opens VRCX, CVRX, and game files read-only and
  runs only when the user presses that button.
- **No invented data.** Unknown or missing values degrade to a safe default.
  Missing data is never a status, a removal, or a join target.

## Request admission

[`ApiAdmissionController`](../src/main/services/adapters/ApiAdmissionController.ts)
is the one queue per platform. Main creates one for VRChat and one for
ChilloutVR; they never share pacing or cooldowns. Sign-in, REST data, retries,
Explore reads, and VRChat API-host image hops all pass through it.

| Rule            | Value                                                                                                             |
| --------------- | ----------------------------------------------------------------------------------------------------------------- |
| Spacing         | At least 1,000 ms between starts (`API_REQUEST_MIN_INTERVAL_MS`), plus 0–99 ms jitter                             |
| Ceiling         | One request per second per platform. This is VRX's own limit, not a vendor allowance                              |
| Queue size      | 256 pending requests; the last 16 places are reserved for interactive work                                        |
| Order           | Retries holding a 429 deadline, then interactive, then default, then background                                   |
| Overflow        | `RequestQueueFullError`. The request fails once and is never replayed                                             |
| Header timing   | Request headers, including credentials, are built only after admission and the session check pass                 |
| Request timeout | 15,000 ms per attempt (`API_TIMEOUT_MS`); REST redirects are refused                                              |
| Circuit breaker | After 3 consecutive failures, that platform's requests fail fast until 60 s after the last one. 429s do not count |

An interactive sign-in resets the circuit breaker so a user with correct
credentials is not blocked by earlier background failures. Pacing and 429
cooldowns still apply to it. Lookups whose miss is an ordinary answer (world,
group and instance metadata, Explore reads) do not open the breaker for a
missing or unreadable item; [API volatility](api-volatility.md) lists exactly
what each counts.

## 429 handling, backoff, and cooldowns

- A 429 sets a shared platform cooldown. VRX honors `Retry-After` as whole
  seconds or an HTTP date. Without a valid header it waits 1 s × 2ⁿ, where n
  counts 429s since the last success, capped at 30 seconds, plus 0–99 ms
  jitter. A cooldown only ever grows.
- Every attempt, including every retry, re-enters admission and waits for the
  latest cooldown before it can send.
- **Batch work stops at the first 429.** Roster pages, world, group, and
  instance enrichment, background CVR instance lookups, and Explore reads use
  no-retry admission. A 429 ends the batch, rejects its queued requests, and
  stops later pages. A cooldown expiring never resumes the old batch.
  Completed data still publishes. An interrupted roster is marked partial, and
  friends it missed stay from the cache.
- **Other requests retry a 429 at most 3 times.** This covers sign-in, session
  checks, the VRChat pipeline token exchange, the VRChat self-invite, and
  interactive CVR instance lookups.
- **Sockets share the cooldown.** A rejected socket upgrade with status 429
  extends the platform's REST cooldown, and every socket connect waits for that
  cooldown first. Sockets do not take an admission slot.
- Cancellation, queue overflow, and a not-yet-saved session are control flow.
  They never count as circuit failures and are never cached as missing data.

## Identification

Every REST request, socket upgrade, and platform image request carries:

```text
User-Agent: VRX/<app version> (https://github.com/Imperix1155/VRX)
```

The version comes from `package.json` at build time. The contact is the public
repository; no personal data is sent. ChilloutVR requests and its socket upgrade
also send `Platform: pc_standalone`, `CompatibleVersions: 0,1,2`, and
`MatureContentDlc: false`.

## Live presence and recovery

Both pipelines share [`ReconnectingPipeline`](../src/main/services/adapters/ReconnectingPipeline.ts).

| Rule              | VRChat Pipeline                                                               | ChilloutVR `/users/ws`                                                       |
| ----------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Handshake timeout | 15,000 ms                                                                     | 15,000 ms                                                                    |
| Reconnect backoff | 1 s × 2ⁿ per failed or short connection, capped at 60 s, plus 0–249 ms jitter | Same                                                                         |
| Backoff reset     | After a connection stays open for 60 seconds                                  | Same                                                                         |
| Keepalive         | None sent; TCP keepalive only (no API traffic)                                | None sent; the `ws` library answers server pings; TCP keepalive only         |
| Extra reconnects  | One after the computer wakes from sleep (at most one per 60 s)                | Same; also at most 2 when a connect's full online set cannot be read         |
| On connect        | One REST roster read to catch up                                              | One REST roster read to catch up; a roster-changed message also triggers one |

Full REST rosters run on first load, on manual refresh, after a socket
reconnects, and on the background reconcile timer. The timer defaults to 1
hour, the cadence VRCX uses for its full friend list. It can be set to 5, 10
or 30 minutes or manual, and varies ±10% per run. Settings files from before
schema v14 that held the old 5-minute default move to 1 hour. It is a safety
net, not a presence poll. A VRChat reconcile re-reads every online and offline
roster page, so a short cadence costs the most for large friend lists.
Concurrent roster requests in one session share a single run. Events that
arrive during that run add at most one final read.

Sign-in status is checked on demand, never on a timer and never because a page
opened: the renderer keeps a settled status until a sign-in, sign-out or
`auth-invalidated` event replaces it. The one exception: a status of `error`
(the check could not reach the platform, for example when VRX starts offline)
is checked again once a minute (`AUTH_ERROR_RECHECK_MS`) until a check
succeeds. Each check is one request through the admission queue.

## Explore limits

Explore discovery is on demand and lives only in memory for the current account.
It has no polling timer. It stops when the window is hidden or minimized, and it
is cleared when the account changes. All Explore reads use the platform's
admission queue with no retries.

| Limit                             | Value                                                                                                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Explore read starts               | 20 per platform per rolling 60 seconds, shared across accounts                                                                                                            |
| VRChat candidate refresh          | 1 read, at most 12 worlds                                                                                                                                                 |
| ChilloutVR candidate refresh      | At most 13 reads: 1 active-worlds list, 6 world details, 6 room details                                                                                                   |
| Opening a world                   | At most 7 reads: 1 world detail and 6 rooms                                                                                                                               |
| Rooms tracked per world           | 100; beyond that coverage is reported as partial                                                                                                                          |
| Job deadline                      | 45 seconds                                                                                                                                                                |
| Freshness                         | Evidence is fresh for 60 seconds                                                                                                                                          |
| Refresh eligibility               | Automatic candidate refresh at most every 5 minutes; manual candidate or world refresh at most every 60 seconds                                                           |
| Explore images                    | 6 new image fetches per platform per 60 seconds, 2 outstanding                                                                                                            |
| Deferred image retries (renderer) | At most 2 per visible world. A full queue waits 2.0–2.75 s; a full window waits until its oldest start expires, plus up to 750 ms. Every wait is clamped to 250–60,000 ms |

Joining from Explore stays main-owned and requires fresh room evidence.
VRChat may re-check one stale room once before launch. ChilloutVR never
re-checks; a stale room is not joinable.

## Joining a game that is already open

VRCX and CVRX both check whether the game is running before a Join and, if it
is, send the player there instead of starting a second copy. VRX does the same,
under **Settings → Behavior → When the game is already open** (Go there by
default; Off always launches).

- **The check is local.** Main reads process image names (`tasklist` on
  Windows, `/proc/<pid>/comm` on Linux, which Wine and Proton set to the game's
  `.exe` name) only when a Join dialog opens or a Join runs, and keeps the
  answer for 2 seconds. It never logs process names and never polls.
- **ChilloutVR:** the usual `chilloutvr://instance/join` link, which the open
  game picks up (the VR or desktop choice no longer applies). No API call.
- **VRChat on Windows**, with **When the game is already open** set to **Go there**:
  the main-built, allowlisted `vrchat://launch` URL goes to VRChat's local
  `VRChatURLLaunchPipe`, the pipe VRChat's own launcher uses. VRChat answers
  one byte; only `1` counts as taken. No API call.
- **VRChat otherwise** (the pipe refused or timed out after 3 seconds, Linux
  and Proton, where the pipe sits inside the game's container, or the user
  picked **Send invite**): one self-invite to the friend's main-owned location,
  public instances included. It is the same single write VRX already makes,
  under the Join's lock and cooldown. VRX never launches a second copy in this
  case.
- **Same account only.** A Join remembers the signed-in account when it
  starts. If that sign-in changes while VRX checks for the game or waits on the
  pipe, the Join stops: no link opens and no invite goes out.

## Avatar limits

The Avatars page reads only when it opens with a platform in view and when the
user presses Refresh. The Dashboard's Wearing now reads only the worn avatar,
when the Dashboard opens with no answer from the last 5 minutes. There is no timer and no read on window focus. Reads use
the platform's admission queue at interactive priority, and the renderer keeps
a result fresh for 5 minutes per account. It keeps the last result in memory
for the rest of the session, so reopening the page shows it at once and reads
again only once it is older than 5 minutes.

| Limit                 | Value                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------- |
| VRChat page open      | At most 6 reads: up to 5 list pages of 100, and the worn avatar queued beside the first |
| ChilloutVR page open  | 2 reads: the avatar list and the user record                                            |
| Opening an avatar     | VRChat: none (the list carries every field). ChilloutVR: 1 read, cached for the session |
| Avatar switch         | One at a time per platform, 5 s after any attempt, never retried                        |
| Concurrent page reads | Share one run per platform                                                              |
| Dashboard open        | 1 read per platform (worn avatar only); none if the Avatars page read it in 5 min       |

Main accepts a switch only for an avatar it listed for the current session, so
the renderer cannot name an arbitrary avatar. A Wear press or details open that
arrives while the list is still loading waits for that read. When the current
session has not read the list yet (for example after a session renewal while
the page still shows the earlier result), main makes that one page-open read
first; it does so at most once per session, whatever the outcome. Avatar state
is cleared at every sign-out, account change, and invalidated session.

## Search, profile and group limits

Search, the full profile, the Groups page, Explore's New and Recently updated
tabs, and the top bar's player counts read only on a user action: Enter,
opening the page or tab, a Show worlds or Show groups press, or Refresh. The
player counts read once when VRX opens and again on a page switch once the
last answer is 5 minutes old. Nothing runs on a timer, on window focus or on
reconnect. Every answer
is cached in main for 5 minutes per account, and concurrent asks share one
read. Refresh re-reads only once the answer is at least 30 seconds old. All
reads use the platform's admission queue at interactive priority with no
automatic retry, and all state is cleared at every sign-out, account change and
invalidated session.

| Limit             | Value                                                                      |
| ----------------- | -------------------------------------------------------------------------- |
| Search            | VRChat 2 reads (people, worlds), ChilloutVR 1; at most one every 2 s each  |
| Opening a profile | 1 read; worlds and groups 1 read each, only after their Show press         |
| Groups page open  | 1 read per platform                                                        |
| Explore list tab  | 1 read per platform                                                        |
| Player counts     | 1 read per shown platform at start and on a page switch; none within 5 min |

## Local action limits

Main also rate-limits the renderer's requests before any network work starts.

| Action                   | Limit                                                                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in                  | 6 per minute                                                                                                                             |
| Two-factor code          | 10 per minute                                                                                                                            |
| Sign-in from this PC     | 6 per minute                                                                                                                             |
| Roster request           | 12 per 30 seconds                                                                                                                        |
| Join a friend's instance | 20 per minute; one launch per platform at a time; 3 s cooldown per friend and destination; this also covers the hand-off to an open game |
| VRChat self-invite       | 20 per minute; one at a time; 3 s cooldown                                                                                               |
| Avatar list              | 30 per minute; concurrent reads share one run                                                                                            |
| Avatar details           | 60 per minute                                                                                                                            |
| Avatar switch            | 24 per minute; one at a time per platform; 5 s cooldown after any attempt                                                                |
| Profile                  | 60 per minute; a person's worlds and groups 30 per minute each                                                                           |
| Search                   | 60 per minute; one platform search every 2 s                                                                                             |
| World lists              | 60 per minute                                                                                                                            |
| Players online, groups   | 30 per minute each                                                                                                                       |
| Join from Explore        | 20 per minute; one launch per platform at a time; 3 s cooldown per destination                                                           |

The full table is `IPC_RATE_LIMIT_BUDGETS` in
[`rate-limit.ts`](../src/main/ipc/rate-limit.ts). Every join also respects the
**Allow joining friends** setting.

## Cancellation across sessions

Each adapter keeps a session generation and an abort signal. Sign-out, a new
sign-in, an account change, or an invalidated session advances the generation
and aborts the signal. That cancels queued requests, in-flight rosters,
enrichment, and Explore jobs, clears per-session caches, and restarts or stops
the socket.

- Every authenticated request carries a lease. The lease is checked before
  admission, after admission, and after the response. A stale lease raises
  `RequestCancelledError` and nothing publishes.
- A newer interactive sign-in supersedes an older one at its next await.
- A restored or tentative session cannot send authenticated REST, open a
  socket, or fetch an API-host image until the adapter has validated its
  owner and saved it.
- An API-host image request captures the session when it starts, and a
  response from an old session is discarded. The VRChat cookie is sent only to
  `api.vrchat.cloud`, never to a CDN redirect target.

[Multi-account architecture](./architecture/multi-account.md) describes the
account identity and epoch rules behind these fences.

## Risk to user accounts

Both platforms can restrict third-party access. Neither VRChat nor ChilloutVR
sanctions VRX, so using it carries some risk to the user's
account. VRX limits that risk by:

- behaving like one careful client: one request per second at most, server
  waits honored, batches stopped at the first 429;
- using the platforms' own sockets for live data instead of polling;
- limiting writes to one user-initiated VRChat self-invite at a time, sent
  only from a Join the user pressed, and one user-initiated avatar switch per
  platform at a time;
- never storing passwords, and keeping session material in main, encrypted at
  rest and invisible to the renderer;
- validating a restored ChilloutVR session once per launch, and confirming a
  data-path 403 with at most one re-authentication per session, so VRX does not
  churn access keys;
- identifying itself honestly with a User-Agent and contact URL.

VRX aims for feature parity with first-party clients only within these limits.
It never trades a user's account safety for a feature.

## When to update this policy

Update this page in the same change when you:

- add an endpoint, socket, host, or socket message VRX sends;
- add a platform write or social action, or wire the ChilloutVR socket senders;
- add anything that reads the network on a timer, or change the reconcile
  choices;
- change a number on this page, a retry mode, a priority class, or the queue;
- change the User-Agent or the platform headers;
- read a new external source, such as another app's session files.

Changes to response shapes or API assumptions go in
[API volatility](./api-volatility.md).
