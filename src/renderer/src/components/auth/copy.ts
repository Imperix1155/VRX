import type { Platform } from '@shared/types'

/**
 * i18n key bundles for the shared auth forms (VRX-221). The login screen and
 * Settings → Accounts speak parallel key families (`login.*` vs
 * `settings.accounts.*`); the bundle is how a form stays surface-agnostic.
 * Quoted literals also keep every key visible to the i18n parity scan.
 */
export interface AuthCopy {
  credentials: {
    username: string
    usernamePlaceholder: string
    password: string
    passwordPlaceholder: string
    submit: string
    submitting: string
  }
  twoFactor: {
    promptTotp: string
    promptEmail: string
    code: string
    placeholder: string
    verify: string
    back: string
  }
}

const LOGIN_COPY_BASE: AuthCopy = {
  credentials: {
    username: 'login.username',
    usernamePlaceholder: 'login.usernamePlaceholder',
    password: 'login.password',
    passwordPlaceholder: 'login.passwordPlaceholder',
    submit: 'login.signIn',
    submitting: 'login.signingIn'
  },
  twoFactor: {
    promptTotp: 'login.twoFactor.promptTotp',
    promptEmail: 'login.twoFactor.promptEmail',
    code: 'login.twoFactor.code',
    placeholder: 'login.twoFactor.placeholder',
    verify: 'login.twoFactor.verify',
    back: 'login.twoFactor.back'
  }
}

/**
 * Login-screen copy for a platform tab (VRX-217). VRChat signs in with a
 * username; ChilloutVR signs in with an EMAIL — the only wording difference.
 */
export function loginCopy(platform: Platform): AuthCopy {
  if (platform === 'chilloutvr') {
    return {
      ...LOGIN_COPY_BASE,
      credentials: { ...LOGIN_COPY_BASE.credentials, username: 'login.email' }
    }
  }
  return LOGIN_COPY_BASE
}

const ACCOUNT_COPY_BASE: AuthCopy = {
  credentials: {
    username: 'settings.accounts.username',
    usernamePlaceholder: 'settings.accounts.usernamePlaceholder',
    password: 'settings.accounts.password',
    passwordPlaceholder: 'settings.accounts.passwordPlaceholder',
    submit: 'settings.accounts.connect',
    submitting: 'settings.accounts.connecting'
  },
  twoFactor: {
    promptTotp: 'settings.accounts.twoFactor.promptTotp',
    promptEmail: 'settings.accounts.twoFactor.promptEmail',
    code: 'settings.accounts.twoFactor.code',
    placeholder: 'settings.accounts.twoFactor.placeholder',
    verify: 'settings.accounts.twoFactor.verify',
    back: 'settings.accounts.twoFactor.back'
  }
}

/** Settings → Accounts copy, with the same per-platform sign-in wording as
 *  the login screen: ChilloutVR asks for an email, not a username. */
export function accountCopy(platform: Platform): AuthCopy {
  if (platform === 'chilloutvr') {
    return {
      ...ACCOUNT_COPY_BASE,
      credentials: { ...ACCOUNT_COPY_BASE.credentials, username: 'settings.accounts.email' }
    }
  }
  return ACCOUNT_COPY_BASE
}
