import type { ActivityEntry, ActivityKeepFor } from '@shared/activity'
import type { Translate } from '../i18n/translate'
import { stripInstanceSuffix } from './worldName'

/** The Keep activity for choices, in words. Written as literals so the locale
 *  parity check sees them. */
export const ACTIVITY_KEEP_LABEL_KEYS: Record<ActivityKeepFor, string> = {
  session: 'activity.keep.options.session',
  '30d': 'activity.keep.options.30d',
  '90d': 'activity.keep.options.90d',
  '1y': 'activity.keep.options.1y',
  forever: 'activity.keep.options.forever'
}

/** What happened, in words. World names drop ChilloutVR's "(#…)" instance tag. */
export function describeActivity(entry: ActivityEntry, t: Translate): string {
  const world = entry.worldName === null ? '' : stripInstanceSuffix(entry.worldName).trim()
  switch (entry.kind) {
    case 'online':
      return world === '' ? t('activity.online') : t('activity.onlineIn', { world })
    case 'world':
      return world === '' ? t('activity.joinedUnknown') : t('activity.joined', { world })
    case 'offline':
      return t('activity.offline')
  }
}

export interface ActivityTimeFormats {
  time: Intl.DateTimeFormat
  dayTime: Intl.DateTimeFormat
  dayYearTime: Intl.DateTimeFormat
}

/** Today shows the time, this year the day and time, older adds the year. */
export function activityTimeFormats(language: string): ActivityTimeFormats {
  return {
    time: new Intl.DateTimeFormat(language, { hour: 'numeric', minute: '2-digit' }),
    dayTime: new Intl.DateTimeFormat(language, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    }),
    dayYearTime: new Intl.DateTimeFormat(language, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    })
  }
}

export function formatActivityTime(at: Date, now: Date, formats: ActivityTimeFormats): string {
  if (at.toDateString() === now.toDateString()) return formats.time.format(at)
  if (at.getFullYear() === now.getFullYear()) return formats.dayTime.format(at)
  return formats.dayYearTime.format(at)
}
