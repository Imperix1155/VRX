import { useTranslation } from 'react-i18next'
import type { TwoFactorMethod } from '@shared/types'
import AuthInput from './AuthInput'
import ErrorBanner from './ErrorBanner'
import type { AuthCopy } from './copy'

/** Identical in both call sites — the quiet secondary action. */
const BACK_CLASS =
  'rounded-control px-[var(--space-4)] py-[var(--space-2)] text-sm text-[var(--text-dim)] hover:bg-[var(--surface-hover)] disabled:opacity-50 motion-safe:transition-colors'

/**
 * Presentational method-aware 2FA prompt (VRX-221) — platform, copy, and
 * styling hooks are passed in; the state machine lives in `useAuthFlow`.
 */
export default function TwoFactorForm({
  idPrefix,
  copy,
  method,
  code,
  isSubmitting,
  errorKey,
  onCodeChange,
  onSubmit,
  onBack,
  inputFocusClass,
  submitClassName,
  formClassName,
  promptClassName,
  ariaLabel
}: {
  idPrefix: string
  copy: AuthCopy
  method: TwoFactorMethod
  code: string
  isSubmitting: boolean
  errorKey: string | null
  onCodeChange: (value: string) => void
  onSubmit: (e: React.FormEvent) => void
  onBack: () => void
  inputFocusClass: string
  submitClassName: string
  formClassName?: string
  promptClassName?: string
  /** Announces the form's platform association (e.g. "VRChat sign-in"). */
  ariaLabel?: string
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <form onSubmit={onSubmit} noValidate className={formClassName} aria-label={ariaLabel}>
      <div className="flex flex-col gap-[var(--space-3)]">
        {/* The prompt sits inside the gap column (AccountCard's original layout);
            LoginScreen adds mb-[space-1] so gap + margin reproduce its mb-[space-4]. */}
        <p
          className={`text-sm text-[var(--text-dim)]${promptClassName ? ` ${promptClassName}` : ''}`}
        >
          {t(method === 'totp' ? copy.twoFactor.promptTotp : copy.twoFactor.promptEmail)}
        </p>

        <div>
          <label
            htmlFor={`${idPrefix}-2fa`}
            className="mb-[var(--space-1)] block text-xs text-[var(--text-dim)]"
          >
            {t(copy.twoFactor.code)}
          </label>
          <AuthInput
            id={`${idPrefix}-2fa`}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            value={code}
            onChange={(e) => onCodeChange(e.target.value)}
            disabled={isSubmitting}
            focusClass={inputFocusClass}
            placeholder={t(copy.twoFactor.placeholder)}
          />
        </div>

        <ErrorBanner errorKey={errorKey} />

        <button type="submit" disabled={isSubmitting || !code} className={submitClassName}>
          {isSubmitting ? t(copy.credentials.submitting) : t(copy.twoFactor.verify)}
        </button>

        <button type="button" onClick={onBack} disabled={isSubmitting} className={BACK_CLASS}>
          {t(copy.twoFactor.back)}
        </button>
      </div>
    </form>
  )
}
