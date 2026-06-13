/**
 * Platform adapter interface (VRX-16)
 *
 * The contract every platform (VRChat, ChilloutVR) implements. Adding a platform =
 * implementing this interface only; the rest of the app speaks the common model
 * (`@shared/types`) and never touches raw platform APIs. Concrete adapters extend
 * the rate-limiting base class (VRX-17). Main-process only.
 */
import type {
  AdapterEvent,
  AuthStatus,
  Credentials,
  Friend,
  InstanceInfo,
  JoinMode,
  LoginResult,
  Platform
} from '@shared/types'

/** Returned by `subscribe()`; call it to stop receiving events and close the stream. */
export type Unsubscribe = () => void

export interface IPlatformAdapter {
  /** Which platform this adapter speaks for. */
  readonly platform: Platform

  // ── Auth ──
  getAuthStatus(): Promise<AuthStatus>
  /** Direct login (username/password + optional 2FA). `needs2fa` drives the retry. */
  login(credentials: Credentials): Promise<LoginResult>
  /** Hybrid auth: import an existing VRCX/CVRX session if present. True if imported. */
  importSession(): Promise<boolean>

  // ── Data (REST) ──
  getFriends(): Promise<Friend[]>
  getInstanceDetails(instanceId: string): Promise<InstanceInfo>
  joinInstance(instanceId: string, mode: JoinMode): Promise<void>
  /** Send yourself an invite to an instance you can access (VRChat `inviteMyselfTo`) — distinct from launching to join. */
  selfInvite(instanceId: string): Promise<void>

  // ── Live (WebSocket) — the stream locked in the M2 interview ──
  /**
   * Subscribe to real-time presence/friend events (the platform's WebSocket). The
   * handler receives normalized `AdapterEvent`s; returns an `Unsubscribe`. This is
   * why the interface is NOT request/response-only: polling friend status is the #1
   * ban risk (CLAUDE.md), so presence MUST come from this live stream.
   */
  subscribe(handler: (event: AdapterEvent) => void): Unsubscribe
}
