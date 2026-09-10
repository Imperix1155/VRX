# VRX — API Policy Stance

## What VRX is (and is not)

VRX is an **unofficial** desktop companion app for VRChat and ChilloutVR. It is **not** affiliated with, endorsed by, or approved by VRChat or Alpha Blend Interactive (the developers of ChilloutVR). The VRChat and ChilloutVR APIs that VRX relies on are **unofficial** — they are not publicly documented by either platform and may change or be withdrawn at any time without notice. Features that depend on these APIs can break without warning.

VRX authenticates **as the user** on the user's own machine. It reads only that user's own social data: friend list, presence/location, instance details, and notifications. VRX is not a bot, not a server, not a mass-invite tool, and does not upload content on behalf of users.

## Etiquette VRX follows

### Compliant User-Agent

Every outbound request carries a descriptive `User-Agent` header identifying the app and providing a contact URL so either platform can reach the project if needed:

```
VRX/<app version> (https://github.com/Imperix1155/VRX)
```

### Rate limiting

- One main-owned controller per platform spaces API attempts by at least one
  second plus jitter. Auth, REST, eligible retries and API-backed image hops
  share that admission path. VRChat and ChilloutVR remain independent. This is
  VRX's conservative local policy, not a vendor-published allowance or a promise
  that requests at this rate cannot be restricted.
- A 429 monotonically extends the affected cooldown using valid `Retry-After`
  seconds or an HTTP date. Missing or invalid headers use growing jittered
  fallback. Every later attempt rechecks the deadline and normal pacing.
- Roster pagination and background metadata stop at the first 429, even with
  a zero-delay Retry-After from another request sharing the platform controller.
  Pending pages, enrichment and refresh follow-ups cannot resume the old run.
  Successfully completed data may publish; interrupted rosters remain partial
  and missing entries are retained from cache. These batches do not
  sleep and replay, and cooldown expiry does not trigger a burst. Other existing
  request kinds retain their bounded retry policy; every allowed retry re-enters
  admission under its original session lease. No additional action retries are
  introduced by this policy.
- Queued requests are bounded. Logout, account changes and superseded login
  attempts cancel obsolete work before dispatch; stale responses cannot publish
  into a replacement session. Headers are built only after admission and lease
  validation. Tentative/restored credentials remain quarantined until ready.
- CDN image bodies have separate bounded concurrency and host cooldowns. A
  credentialed API image hop still uses platform admission; redirects keep their
  original lease and never forward the API cookie to the CDN. Updater downloads
  are outside these platform queues.

### Real-time data and recovery

WebSockets remain the live presence/location source. Full REST rosters serve
initial load, manual refresh, reconnect recovery and the existing jittered
recovery interval. Concurrent callers, including CVR name warming, share one
refresh per session. Events during its first read request at most one final
read; later events and recovery remain available. No new presence poll is added.

Socket reconnect backoff grows through brief opens and resets after a sustained
open of at least 60 seconds. Rejected-upgrade 429s share the platform cooldown.
Waits honor extensions and cancel when the pipeline stops; no additional
heartbeat protocol or socket is used.

### No mass actions

VRX does not send bulk invites, does not automate social actions on the user's behalf, and does not perform any action that would constitute botting under either platform's community guidelines.

### Defensive parsing

Responses containing unknown enum values, unexpected fields, or missing optional data degrade gracefully — unknown values are ignored or mapped to a safe default. VRX never crashes on an API change it hasn't seen before. See [`docs/api-volatility.md`](./api-volatility.md) for the catalog of volatile API surfaces and resilience strategies.

## Risk disclosure

Because both APIs are unofficial and undocumented:

- Either platform may change its API at any time, breaking VRX features without prior notice.
- Either platform may restrict or block third-party API access in the future.
- Account risk: although VRX is designed to behave like a well-mannered first-party client, neither VRChat Inc. nor Alpha Blend Interactive officially sanction third-party API access. Use VRX at your own risk.

VRX's posture is **feature-maximum parity within the constraints of safe, respectful API use** — never at the cost of getting users' accounts flagged or blocked.
