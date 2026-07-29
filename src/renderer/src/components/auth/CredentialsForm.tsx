import { useTranslation } from 'react-i18next'
import AuthInput from './AuthInput'
import ErrorBanner from './ErrorBanner'
import type { AuthCopy } from './copy'

/**
 * Presentational username/password form (VRX-221) — the platform, copy, and
 * styling hooks are passed in; the state machine lives in `useAuthFlow`.
 */
export default function CredentialsForm({
  idPrefix,
  copy,
  username,
  password,
  isSubmitting,
  errorKey,
  onUsernameChange,
  onPasswordChange,
  onSubmit,
  inputFocusClass,
  submitClassName,
  formClassName
}: {
  idPrefix: string
  copy: AuthCopy
  username: string
  password: string
  isSubmitting: boolean
  errorKey: string | null
  onUsernameChange: (value: string) => void
  onPasswordChange: (value: string) => void
  onSubmit: (e: React.FormEvent) => void
  inputFocusClass: string
  submitClassName: string
  formClassName?: string
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <form onSubmit={onSubmit} noValidate className={formClassName}>
      <div className="flex flex-col gap-[var(--space-3)]">
        <div>
          <label
            htmlFor={`${idPrefix}-username`}
            className="mb-[var(--space-1)] block text-xs text-[var(--text-dim)]"
          >
            {t(copy.credentials.username)}
          </label>
          <AuthInput
            id={`${idPrefix}-username`}
            type="text"
            autoComplete="username"
            required
            value={username}
            onChange={(e) => onUsernameChange(e.target.value)}
            disabled={isSubmitting}
            focusClass={inputFocusClass}
            placeholder={t(copy.credentials.usernamePlaceholder)}
          />
        </div>

        <div>
          <label
            htmlFor={`${idPrefix}-password`}
            className="mb-[var(--space-1)] block text-xs text-[var(--text-dim)]"
          >
            {t(copy.credentials.password)}
          </label>
          <AuthInput
            id={`${idPrefix}-password`}
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => onPasswordChange(e.target.value)}
            disabled={isSubmitting}
            focusClass={inputFocusClass}
            placeholder={t(copy.credentials.passwordPlaceholder)}
          />
        </div>

        <ErrorBanner errorKey={errorKey} />

        <button
          type="submit"
          disabled={isSubmitting || !username || !password}
          className={submitClassName}
        >
          {isSubmitting ? t(copy.credentials.submitting) : t(copy.credentials.submit)}
        </button>
      </div>
    </form>
  )
}
