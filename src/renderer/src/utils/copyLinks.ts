import type { TFunction } from 'i18next'
import { shareLink } from '@shared/shareLinks'
import type { Platform } from '@shared/types'

/** What a "Copy link" button needs: the link, and words that say what it is to. */
export interface CopyLink {
  link: string
  ariaLabel: string
}

/** The copyable link to a person, or undefined when their ID has no link. */
export function personCopyLink(
  platform: Platform,
  userId: string,
  name: string,
  t: TFunction
): CopyLink | undefined {
  const link = shareLink({ kind: 'user', platform, userId })
  return link === null ? undefined : { link, ariaLabel: t('copyLink.personAria', { name }) }
}
