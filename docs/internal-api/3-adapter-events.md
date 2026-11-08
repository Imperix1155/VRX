# 3. Live adapter events (`AdapterEvent`)

Part of the [internal API catalog](../INTERNAL-API.md). The code is the source of truth: read the file a row names before relying on it.

[`AdapterEvent`](../../src/shared/types.ts) is the normalized live vocabulary. Each platform maps its WebSocket wire into these events; the renderer never sees raw platform objects. Presence comes only from this stream (VRChat Pipeline and ChilloutVR `/users/ws`), never from polling.

Main fan-out: [`wireAdapterEvents`](../../src/main/adapterWiring.ts) subscribes to both adapters and hands every event, in order, to `AppStatusService.recordConnection` (`connection` only), `LocationAuthority.consume`, `FriendAlerts.consume`, `InboxService.consume`, and the `friend-event` broadcast. `inbox` events go only to `InboxService` and are never broadcast, so `FriendEvent` is built from `BroadcastAdapterEvent`. Each consumer is isolated, so one throwing consumer cannot block the rest. The broadcast also clears `ExploreService`, `AvatarLibraryService`, `CommunityService`, `HomeWorldService`, `SocialActionService`, `OwnProfileService` and `FriendActionsService` for the platform on `auth-invalidated`. In the renderer, [`useLiveFriendEvents`](../../src/renderer/src/hooks/useLiveFriendEvents.ts) applies events through [`applyFriendEvent`](../../src/renderer/src/utils/applyFriendEvent.ts).

| Event and payload | Produced by | Effect |
| --- | --- | --- |
| `friend-presence` `{ friend }` | VRChat `friend-online` and `friend-location` (in game), `friend-active` (online, not in game). | Upserts the full friend, keeping local `isFavorite`, `favoriteGroupIds` and `linkedPersonId`. Updates main's location and may raise alerts. |
| `friend-offline` `{ platformUserId }` | VRChat `friend-offline`. The wire carries no user object. | Sets the cached friend offline and clears `status`, `statusDescription` and `instance`; profile fields stay. Unknown ids are ignored. |
| `friend-updated` `{ friend }` | VRChat `friend-update`. | Merges profile fields only; cached presence and instance stay. An unknown friend is not inserted. `FriendAlerts` recomputes hot-instance membership from the new status. |
| `friend-added` `{ friend }` | VRChat `friend-add`. State comes from the payload's own user state, defaulting to `active`. | Upsert. |
| `friend-removed` `{ platformUserId }` | VRChat `friend-delete`. | Removes the friend. |
| `world-metadata` `{ worldId, worldName, thumbnailUrl }` | VRChat background world lookups after a roster read and for live friend events in an instance, fenced to the current session. | Patches name and thumbnail only on friends whose current `instance.worldId` matches. Never inserts or touches presence. `LocationAuthority` and `FriendAlerts` ignore it, so it cannot move a fence or alert. |
| `group-metadata` `{ groupId, groupName, groupImageUrl }` | VRChat background group lookups, same triggers and fencing as worlds. | Patches group name and image only on friends whose current `instance.groupId` matches. Ignored by `LocationAuthority` and `FriendAlerts`. |
| `presence-snapshot` `{ entries }` | ChilloutVR `ONLINE_FRIENDS`. The pipeline merges deltas into the full online set; `CvrAdapter` re-emits an enriched snapshot when instance lookups resolve. | Patches presence and instance by id; absent friends of that platform go offline. Unchanged rows keep identity. The renderer keeps the latest snapshot per platform and reapplies it after a roster fetch. |
| `roster-changed` | ChilloutVR `FRIEND_LIST_UPDATED`. | Trigger only: the renderer refetches the roster over REST. |
| `inbox` `{ change }` | VRChat `notification` (`invite`, `requestInvite`, `friendRequest`), `hide-notification`, `response-notification`, `clear-notification`. ChilloutVR `INVITES` (15), `REQUEST_INVITES` (20), `FRIEND_REQUESTS` (25). `change` is `add`, `remove` or `clear`. | `InboxService` only. Rows dedupe by sender and kind, cap at 50 per platform and may raise an invite or friend-request alert. `friend-added` and roster reads settle friend requests. Never reaches the renderer stream. |
| `friends-snapshot` `{ scope, friends }` | No producer. | `all` replaces the roster; `online` marks absent friends offline and upserts the rest. |
| `connection` `{ health }` | [`ReconnectingPipeline`](../../src/main/services/adapters/ReconnectingPipeline.ts) on both platforms: `down` with no session, `reconnecting` at dial and after close, `live` on open. | Recorded by `AppStatusService` for `get-app-status`. Main marks the location authority stale. The renderer drops its buffered snapshot; on `live` it refetches friends, or only rechecks auth while quarantined. |
| `auth-invalidated` | Explicit logout on both platforms. VRChat: a data-path 401 (roster, metadata, self-invite, Explore). ChilloutVR: a data-path 401, a 403 confirmed by one key reauth, or a failed save of a rotated key. | Main clears Explore and alert state and marks locations stale. The renderer quarantines the platform: roster `[]`, in-flight fetches cancelled, auth rechecked, live events dropped until an authenticated status, which also resets community answers and game favorites. |

Rules when extending:

- Stay honest to the wire. Do not fabricate fields a platform does not send; that is why `friend-offline` carries only an id and `presence-snapshot` carries no profiles.
- Extend the union, `applyFriendEvent`, `LocationAuthority`, `FriendAlerts` and their tests together. Metadata-only events must not advance location revisions or raise alerts.
- ChilloutVR friends never carry `status`, `statusDescription` or `trustRank`, and their presence is only `in-game` or `offline`.
- `connection: 'live'` is not proof of authentication. Only an authenticated auth status lifts a renderer quarantine.
