import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  type AuthStatus,
  type LoginResult,
  type Platform,
  type TwoFactorMethod
} from '@shared/types'
import { authStatusQueryKey } from '../queries/auth'
import { rememberLoginPlatform } from '../utils/lastLoginPlatform'

/**
 * Shared credentials/2FA auth state machine (VRX-221) — the single owner of a
 * flow LoginScreen and AccountCard previously hand-implemented twice.
 *
 * Flow: credentials → login() → on needs2fa → method-aware code prompt →
 * verify2fa() (the second leg authenticates via the session cookie, so no
 * credentials are resent). Security invariants held here so no call site can
 * drop them:
 *
 * - The PASSWORD IS DROPPED from state the moment 2FA is requested (VRX-159).
 * - CVR has no 2FA today (the adapter rejects codes) — a `needs2fa` result on
 *   any platform but VRChat falls back to the generic error, never an
 *   unusable prompt. When CVR grows a second factor (the seam is documented
 *   in CvrAdapter.login), THIS is the single place to extend.
 * - Known adapter result codes map through the surface-provided function; bridge
 *   failures stay generic and neither case silently re-enables the form.
 */
export interface UseAuthFlowOptions {
  /** Maps a typed adapter result code (or bridge failure with no code) to this surface's copy. */
  errorKeyForCode: (code?: string) => string
  /**
   * One-time seed for a VRChat needs-2fa reprompt. Prefer externalTwoFactor
   * when the owning auth-status query can change while the surface is mounted.
   */
  initialTwoFactor?: TwoFactorMethod | null
  /**
   * Reactive 2FA method from the auth-status query (AccountCard: a restored
   * session can drift into needs-2fa while the card is mounted).
   */
  externalTwoFactor?: TwoFactorMethod | null
  /**
   * AccountCard policy: the password never survives a submit — it is cleared
   * right after the login IPC resolves, before query invalidations settle.
   * (LoginScreen keeps it on a failed attempt so a typo doesn't force retyping.)
   */
  dropPasswordAfterSubmit?: boolean
  /** Extra per-surface success work (AccountCard also settles the friends cache). */
  onSuccess?: () => Promise<unknown> | void
  /** Reports whether main cleared the session so the surface must preserve its terminal error. */
  onSubmissionSettled?: (sessionCleared: boolean) => void
}

export interface AuthFlow {
  username: string
  setUsername: (value: string) => void
  password: string
  setPassword: (value: string) => void
  twoFactorCode: string
  setTwoFactorCode: (value: string) => void
  /** The active 2FA method, or null when the credentials form should show. */
  pending2fa: TwoFactorMethod | null
  errorKey: string | null
  setErrorKey: (key: string | null) => void
  isSubmitting: boolean
  /** True while the running submission is a PC sign-in import. */
  isImporting: boolean
  handleSubmit: (e: React.FormEvent) => Promise<void>
  /** Sign in with the session VRCX (VRChat) or ChilloutVR/CVRX saved on this PC. */
  handleImport: () => Promise<void>
  /** Escape hatch back to the full credentials form (keeps the username). */
  handleBack: () => void
}

export function useAuthFlow(
  platform: Platform,
  {
    errorKeyForCode,
    initialTwoFactor = null,
    externalTwoFactor = null,
    dropPasswordAfterSubmit = false,
    onSuccess,
    onSubmissionSettled
  }: UseAuthFlowOptions
): AuthFlow {
  const queryClient = useQueryClient()

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [twoFactorCode, setTwoFactorCode] = useState('')
  // 'credentials' = the user pressed Back — force the credentials form even if
  // the auth-status query still reports needs-2fa.
  const [twoFactorOverride, setTwoFactorOverride] = useState<
    TwoFactorMethod | 'credentials' | null
  >(initialTwoFactor)
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [previousExternalTwoFactor, setPreviousExternalTwoFactor] =
    useState<TwoFactorMethod | null>(externalTwoFactor)

  // A restored session can become needs-2fa while a credentials form is
  // mounted. Adjust the dependent state before rendering that transition so
  // no typed secret survives behind the code prompt. Back may then deliberately
  // reopen a fresh credentials attempt.
  if (externalTwoFactor !== previousExternalTwoFactor) {
    setPreviousExternalTwoFactor(externalTwoFactor)
    if (externalTwoFactor !== null) {
      setPassword('')
      setTwoFactorCode('')
    }
  }

  const pending2fa =
    twoFactorOverride === 'credentials' ? null : (twoFactorOverride ?? externalTwoFactor)

  /** Shared settlement for a password login, a 2FA code and a PC sign-in import. */
  async function run(
    request: (bridge: NonNullable<Window['vrx']>) => Promise<LoginResult>
  ): Promise<void> {
    setErrorKey(null)

    const bridge = window.vrx
    if (!bridge) {
      setErrorKey(errorKeyForCode())
      onSubmissionSettled?.(false)
      return
    }

    setIsSubmitting(true)
    let sessionWasCleared = false
    try {
      const result = await request(bridge)

      if (result.ok) {
        // LoginScreen reopens on the platform signed in to last.
        rememberLoginPlatform(platform)
        // Invalidate so the auth gate / card re-checks and transitions. The 2FA
        // state is cleared only AFTER the invalidations settle: clearing it
        // first would flash the credentials form while the gate refetches.
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: authStatusQueryKey(platform) }),
          onSuccess?.()
        ])
        setTwoFactorOverride(null)
        setTwoFactorCode('')
      } else if (result.needs2fa && platform === 'vrchat') {
        setTwoFactorOverride(result.method)
        setPassword('') // drop the secret — the 2FA leg authenticates via the cookie
        setTwoFactorCode('')
      } else {
        // Plain adapter failures preserve their typed code for the surface
        // mapper. A needs2fa result on CVR has no failure code and stays generic.
        const errorCode = 'error' in result ? result.error : undefined
        if ('sessionCleared' in result && result.sessionCleared === true) {
          sessionWasCleared = true
          // Main explicitly discarded the session, so neither completed 2FA nor
          // a replacement-login failure can be retried against cached auth.
          setPassword('')
          setTwoFactorOverride('credentials')
          setTwoFactorCode('')
          // Replace stale needs-2fa data synchronously so a tab/card remount
          // cannot seed another code prompt before any background refetch.
          await queryClient.cancelQueries({ queryKey: authStatusQueryKey(platform) })
          queryClient.setQueryData<AuthStatus>(authStatusQueryKey(platform), {
            platform,
            state: 'unauthenticated',
            accountId: null,
            displayName: null
          })
        }
        setErrorKey(errorKeyForCode(errorCode))
      }
    } catch {
      // Bridge/IPC failure (e.g. the main handler threw) — surface it instead of
      // silently re-enabling the button with no feedback.
      setErrorKey(errorKeyForCode())
    } finally {
      if (dropPasswordAfterSubmit) setPassword('')
      onSubmissionSettled?.(sessionWasCleared)
      setIsSubmitting(false)
    }
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    await run((bridge) =>
      pending2fa
        ? // Authenticator apps often copy a code as "123 456".
          bridge.verify2fa({ platform, code: twoFactorCode.replace(/\s+/g, '') })
        : bridge
            .login({ platform, credentials: { username, password } })
            // The secret leaves state the moment the login IPC settles — a
            // separate microtask so the clear renders BEFORE the needs2fa
            // transition can unmount the password input (pinned by
            // AccountCard's held-invalidation test).
            .finally(() => {
              if (dropPasswordAfterSubmit) setPassword('')
            })
    )
  }

  /**
   * "Use my sign-in from this PC" (owner, 2026-10-20). An explicit press; main
   * reads VRCX or ChilloutVR/CVRX read-only and validates before saving. A
   * typed password is not sent and is dropped, since this attempt replaces it.
   */
  async function handleImport(): Promise<void> {
    setPassword('')
    setIsImporting(true)
    try {
      await run((bridge) => bridge.importSession({ platform }))
    } finally {
      setIsImporting(false)
    }
  }

  function handleBack(): void {
    setTwoFactorOverride('credentials')
    setTwoFactorCode('')
    setErrorKey(null)
  }

  return {
    username,
    setUsername,
    password,
    setPassword,
    twoFactorCode,
    setTwoFactorCode,
    pending2fa,
    errorKey,
    setErrorKey,
    isSubmitting,
    isImporting,
    handleSubmit,
    handleImport,
    handleBack
  }
}
