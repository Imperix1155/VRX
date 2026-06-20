import { z } from 'zod'
import { CVR_API_BASE, CVR_PLATFORM } from '@shared/constants'
import type { Platform } from '@shared/types'
import { BaseAdapter } from './BaseAdapter'
import {
  AuthError,
  CVRAuthError,
  CVRNetworkError,
  CVRRateLimitError,
  NetworkError,
  RateLimitError
} from './errors'

const CVR_USER_AGENT = 'VRX/0.1.0 (https://github.com/Imperix1155/VRX)' as const

const cvrUserAuthSchema = z.object({
  username: z.string(),
  accessKey: z.string(),
  userId: z.string(),
  currentAvatar: z.string(),
  currentHomeWorld: z.string(),
  videoUrlResolverExecutable: z.string(),
  videoUrlResolverHashes: z.string(),
  blockedUsers: z.array(z.string())
})

export type CVRUserAuth = z.infer<typeof cvrUserAuthSchema>

export interface CVRCredentials {
  username: string
  accessKey: string
}

/** Low-level, main-process-only ChilloutVR HTTP client. */
export abstract class CvrApiClient extends BaseAdapter {
  readonly platform: Platform = 'chilloutvr'

  private credentials: CVRCredentials | null = null

  /** Supply or clear the in-memory credentials used by authenticated calls. */
  protected setCredentials(credentials: CVRCredentials | null): void {
    this.credentials = credentials
  }

  /** GET an authenticated CVR endpoint and unwrap its validated data envelope. */
  protected async get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    return await this.requestData(path, schema, {
      method: 'GET',
      headers: this.authenticatedHeaders()
    })
  }

  /** POST JSON to an authenticated CVR endpoint and unwrap its validated data envelope. */
  protected async post<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
    return await this.requestData(path, schema, {
      method: 'POST',
      headers: this.authenticatedHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body)
    })
  }

  /** First login: email and password using CVR's PASSWORD auth method. */
  protected loginWithPassword(email: string, password: string): Promise<CVRUserAuth> {
    return this.authenticate(2, email, password)
  }

  /** Re-authenticate: username and access key using CVR's ACCESS_KEY auth method. */
  protected reauthenticate(username: string, accessKey: string): Promise<CVRUserAuth> {
    return this.authenticate(1, username, accessKey)
  }

  private authenticate(authType: 1 | 2, username: string, password: string): Promise<CVRUserAuth> {
    return this.requestData('/users/auth', cvrUserAuthSchema, {
      method: 'POST',
      headers: this.baseHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ AuthType: authType, Username: username, Password: password })
    })
  }

  private async requestData<T>(
    path: string,
    schema: z.ZodType<T>,
    options: RequestInit
  ): Promise<T> {
    try {
      const envelope = await this.request(
        CVR_API_BASE + path,
        z.object({ message: z.string(), data: schema }),
        options
      )
      return envelope.data
    } catch (error) {
      if (error instanceof CVRAuthError) throw error
      if (error instanceof AuthError) throw new CVRAuthError(error.message)
      if (error instanceof RateLimitError) throw new CVRRateLimitError(error.retryAfterMs)
      if (error instanceof NetworkError) throw new CVRNetworkError(error.message, error)
      throw error
    }
  }

  private authenticatedHeaders(extra?: Record<string, string>): Record<string, string> {
    if (!this.credentials) throw new CVRAuthError()
    return this.baseHeaders({
      Username: this.credentials.username,
      AccessKey: this.credentials.accessKey,
      ...extra
    })
  }

  private baseHeaders(extra?: Record<string, string>): Record<string, string> {
    return {
      'User-Agent': CVR_USER_AGENT,
      Platform: CVR_PLATFORM,
      CompatibleVersions: '0,1,2',
      MatureContentDlc: 'false',
      ...extra
    }
  }
}
