/**
 * The instance log on the Activity page (owner, 2026-11-15): the rooms the
 * signed-in user was in, newest first, each opening to show who was there.
 * One row layout for both platforms. Everything here is read from this
 * computer's saved history through main; nothing asks a platform.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { InstanceVisit } from '@shared/instanceLog'
import { asTranslate } from '../i18n/translate'
import { useVisitPeople } from '../queries/instanceLog'
import { formatActivityTime, formatStay, type ActivityTimeFormats } from '../utils/activityText'
import { stripInstanceSuffix } from '../utils/worldName'
import PlatformPill from './PlatformPill'

function VisitPeople({
  visit,
  now,
  formats
}: {
  visit: InstanceVisit
  now: Date
  formats: ActivityTimeFormats
}): React.JSX.Element {
  const { t } = useTranslation()
  const { people, failed } = useVisitPeople(visit.platform, visit.id, true)
  if (people === undefined) {
    return (
      <p className="px-[var(--space-3)] pb-[var(--space-2)] text-xs text-[var(--text-dim)]">
        {failed ? t('instances.peopleFailed') : t('instances.peopleLoading')}
      </p>
    )
  }
  if (people.length === 0) {
    return (
      <p className="px-[var(--space-3)] pb-[var(--space-2)] text-xs text-[var(--text-dim)]">
        {t('instances.peopleEmpty')}
      </p>
    )
  }
  return (
    <ul className="flex flex-col gap-[2px] px-[var(--space-3)] pb-[var(--space-2)]">
      {people.map((person) => {
        const joined = formatActivityTime(new Date(person.joinedAt), now, formats)
        const left =
          person.leftAt === null
            ? visit.current
              ? t('instances.stillHere')
              : null
            : formatActivityTime(new Date(person.leftAt), now, formats)
        return (
          <li
            key={person.platformUserId}
            className="flex items-baseline gap-[var(--space-3)] text-[13px]"
          >
            <span className="min-w-0 flex-1 truncate text-[var(--text)]" title={person.displayName}>
              {person.displayName}
            </span>
            <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-[var(--text-dim)]">
              {left === null ? joined : t('instances.timeRange', { from: joined, to: left })}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

function VisitRow({
  visit,
  now,
  formats
}: {
  visit: InstanceVisit
  now: Date
  formats: ActivityTimeFormats
}): React.JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const translate = asTranslate(t)
  const world =
    visit.worldName === null || stripInstanceSuffix(visit.worldName).trim() === ''
      ? t('instances.unknownWorld')
      : stripInstanceSuffix(visit.worldName).trim()
  const people =
    visit.people === 0 ? t('instances.noPeople') : t('instances.people', { count: visit.people })
  // A visit whose end was never seen has no length to show.
  const stay = visit.current
    ? t('instances.hereNow')
    : visit.leftAt === null
      ? null
      : formatStay(visit.leftAt - visit.enteredAt, translate)
  const summary = stay === null ? people : t('instances.summary', { stay, people })
  const entered = new Date(visit.enteredAt)
  const time = formatActivityTime(entered, now, formats)
  return (
    <li className={`platform-row platform-row--${visit.platform}`} data-instance-visit={visit.id}>
      <button
        type="button"
        aria-expanded={open}
        aria-label={t('instances.rowAria', {
          world,
          platform: t(
            visit.platform === 'vrchat' ? 'dashboard.platformVrc' : 'dashboard.platformCvr'
          ),
          summary,
          time
        })}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full cursor-pointer items-center gap-[var(--space-3)] rounded-control px-[var(--space-3)] py-[var(--space-2)] text-left hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--text-dim)] motion-safe:transition-colors"
      >
        <span className="min-w-0 flex-1">
          <span
            className="block truncate text-sm font-medium text-[var(--text)]"
            title={visit.worldName ?? undefined}
          >
            {world}
          </span>
          <span className="block truncate text-xs text-[var(--text-dim)]">{summary}</span>
        </span>
        <span className="flex w-[96px] shrink-0">
          <PlatformPill platform={visit.platform} className="w-full" />
        </span>
        <time
          dateTime={entered.toISOString()}
          className="w-[104px] shrink-0 whitespace-nowrap text-right text-xs tabular-nums text-[var(--text-dim)]"
        >
          {time}
        </time>
      </button>
      {open && <VisitPeople visit={visit} now={now} formats={formats} />}
    </li>
  )
}

export default function InstanceVisitList({
  visits,
  now,
  formats
}: {
  visits: readonly InstanceVisit[]
  now: Date
  formats: ActivityTimeFormats
}): React.JSX.Element {
  return (
    <ol className="flex flex-col gap-[6px]">
      {visits.map((visit) => (
        <VisitRow key={`${visit.platform}:${visit.id}`} visit={visit} now={now} formats={formats} />
      ))}
    </ol>
  )
}
