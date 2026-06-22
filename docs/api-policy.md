# VRX — API Policy Stance

## What VRX is (and is not)

VRX is an **unofficial** desktop companion app for VRChat and ChilloutVR. It is **not** affiliated with, endorsed by, or approved by VRChat or Alpha Blend Interactive (the developers of ChilloutVR). The VRChat and ChilloutVR APIs that VRX relies on are **unofficial** — they are not publicly documented by either platform and may change or be withdrawn at any time without notice. Features that depend on these APIs can break without warning.

VRX authenticates **as the user** on the user's own machine. It reads only that user's own social data: friend list, presence/location, instance details, and notifications. VRX is not a bot, not a server, not a mass-invite tool, and does not upload content on behalf of users.

## Etiquette VRX follows

### Compliant User-Agent

Every outbound request carries a descriptive `User-Agent` header identifying the app and providing a contact URL so either platform can reach the project if needed:

```
VRX/0.1.0 (https://github.com/Imperix1155/VRX)
```

### Rate limiting

- VRX enforces a ceiling of approximately **1 request per second** per platform.
- All HTTP clients use **exponential backoff with random jitter** — never fixed-interval retries — to avoid synchronized burst patterns.
- `429 Too Many Requests` responses are respected immediately. If the server returns a `Retry-After` header, VRX waits that exact duration before retrying.

### Real-time data via WebSocket, not polling

Friend presence and location updates are received through the platform's push channel (VRChat Pipeline WebSocket / ChilloutVR `/users/ws`) rather than polling. Polling friend status is the primary cause of rate-limiting and account flags on VRChat; VRX avoids it entirely.

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
