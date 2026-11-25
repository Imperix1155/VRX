import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import {
  DO_NOT_DISTURB_CHOICES,
  doNotDisturbRemain,
  isDoNotDisturbActive,
  startDoNotDisturb,
  type DoNotDisturbChoice,
  type DoNotDisturbRemain
} from '@shared/doNotDisturb'
import { useSettingsStore } from '../stores/settings'
import SegmentedControl from './SegmentedControl'
import Toggle from './Toggle'

const CHOICE_LABEL_KEYS: Record<DoNotDisturbChoice, string> = {
  off: 'settings.doNotDisturb.off',
  '1h': 'settings.doNotDisturb.oneHour',
  '3h': 'settings.doNotDisturb.threeHours',
  'until-off': 'settings.doNotDisturb.untilOff'
}

function remainText(t: TFunction, remain: DoNotDisturbRemain): string {
  switch (remain.kind) {
    case 'off':
      return ''
    case 'until-off':
      return t('settings.doNotDisturb.untilOffDetail')
    case 'under-a-minute':
      return t('settings.doNotDisturb.underAMinute')
    case 'minutes':
      return t('settings.doNotDisturb.minutes', { count: remain.count })
    case 'hours':
      return t('settings.doNotDisturb.hours', { count: remain.count })
    case 'hours-minutes':
      return t('settings.doNotDisturb.hoursMinutes', {
        count: remain.hours,
        hours: remain.hours,
        minutes: remain.minutes
      })
  }
}

function useAgeNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

/** Settings → Notifications. One control mutes every desktop and VR alert. */
export function DoNotDisturbCard(): React.JSX.Element {
  const { t } = useTranslation()
  const noteId = useId()
  const choice = useSettingsStore((s) => s.settings.doNotDisturb)
  const until = useSettingsStore((s) => s.settings.doNotDisturbUntil)
  const endOnGameStart = useSettingsStore((s) => s.settings.doNotDisturbEndOnGameStart)
  const followStatus = useSettingsStore((s) => s.settings.doNotDisturbFollowStatus)
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const now = useAgeNow()
  const selected: DoNotDisturbChoice = isDoNotDisturbActive(choice, until, now) ? choice : 'off'
  const detail = remainText(t, doNotDisturbRemain(choice, until, now))

  return (
    <div className="setting-card">
      <div className="setting-row flex-wrap">
        <div>
          <p className="text-sm font-medium text-[var(--text)]">
            {t('settings.doNotDisturb.label')}
          </p>
          <p id={noteId} className="mt-[var(--space-0-5)] text-xs text-[var(--text-dim)]">
            {detail === '' ? t('settings.doNotDisturb.description') : detail}
          </p>
        </div>
        <SegmentedControl<DoNotDisturbChoice>
          values={DO_NOT_DISTURB_CHOICES}
          active={selected}
          labelKeys={CHOICE_LABEL_KEYS}
          ariaLabel={t('settings.doNotDisturb.aria')}
          ariaDescribedBy={noteId}
          onChange={(value) => updateSettings(startDoNotDisturb(value, Date.now()))}
        />
      </div>
      <div className="setting-children">
        <SwitchRow
          label={t('settings.doNotDisturb.endOnGameStart.label')}
          description={t('settings.doNotDisturb.endOnGameStart.description')}
          ariaLabel={t('settings.doNotDisturb.endOnGameStart.aria')}
          checked={endOnGameStart}
          onChange={(checked) => updateSettings({ doNotDisturbEndOnGameStart: checked })}
        />
        <SwitchRow
          label={t('settings.doNotDisturb.followStatus.label')}
          description={t('settings.doNotDisturb.followStatus.description')}
          ariaLabel={t('settings.doNotDisturb.followStatus.aria')}
          checked={followStatus}
          onChange={(checked) => updateSettings({ doNotDisturbFollowStatus: checked })}
        />
      </div>
    </div>
  )
}

function SwitchRow({
  label,
  description,
  ariaLabel,
  checked,
  onChange
}: {
  label: string
  description: string
  ariaLabel: string
  checked: boolean
  onChange: (checked: boolean) => void
}): React.JSX.Element {
  const descriptionId = useId()
  return (
    <div className="setting-row">
      <div>
        <p className="text-sm font-medium text-[var(--text)]">{label}</p>
        <p id={descriptionId} className="mt-[var(--space-0-5)] text-xs text-[var(--text-dim)]">
          {description}
        </p>
      </div>
      <Toggle
        checked={checked}
        ariaLabel={ariaLabel}
        ariaDescribedBy={descriptionId}
        onChange={onChange}
      />
    </div>
  )
}

/** A short control above the sidebar foot. Off opens the durations. On turns it off. */
export function SidebarDoNotDisturb(): React.JSX.Element {
  const { t } = useTranslation()
  const choice = useSettingsStore((s) => s.settings.doNotDisturb)
  const until = useSettingsStore((s) => s.settings.doNotDisturbUntil)
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const now = useAgeNow()
  const active = isDoNotDisturbActive(choice, until, now)
  const detail = remainText(t, doNotDisturbRemain(choice, until, now))
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    const onPointer = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && root.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [open])

  const choose = (value: DoNotDisturbChoice): void => {
    updateSettings(startDoNotDisturb(value, Date.now()))
    setOpen(false)
  }

  return (
    <div ref={root} className="relative mt-[12px]">
      <button
        type="button"
        aria-expanded={active ? undefined : open}
        aria-label={
          active
            ? t('settings.doNotDisturb.sidebar.turnOff', { detail })
            : t('settings.doNotDisturb.sidebar.open')
        }
        onClick={() => {
          if (active) choose('off')
          else setOpen((value) => !value)
        }}
        className={[
          'flex w-full items-center rounded-control border border-transparent px-[11px] py-[9px]',
          'text-left text-[13px] font-semibold',
          active
            ? 'text-[var(--text)]'
            : 'text-[var(--text-dim)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]',
          'focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--text-dim)] cursor-pointer'
        ].join(' ')}
        style={
          active
            ? {
                background: 'var(--control-active-bg)',
                borderColor: 'var(--control-active-border)',
                boxShadow: 'var(--control-active-shadow)'
              }
            : undefined
        }
      >
        <span className="min-w-0">
          <span className="block">{t('settings.doNotDisturb.label')}</span>
          {active && detail !== '' ? (
            <span className="block text-[11px] font-medium text-[var(--text-dim)]">{detail}</span>
          ) : null}
        </span>
      </button>
      {open && !active ? (
        <div
          role="menu"
          aria-label={t('settings.doNotDisturb.aria')}
          className="glass glass-information absolute bottom-[calc(100%+6px)] left-0 z-30 flex w-full flex-col gap-[2px] p-[4px]"
        >
          {(['1h', '3h', 'until-off'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="menuitem"
              onClick={() => choose(value)}
              className="rounded-control px-[11px] py-[8px] text-left text-[13px] font-semibold text-[var(--text)] hover:bg-[var(--surface-hover)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--text-dim)] cursor-pointer"
            >
              {t(CHOICE_LABEL_KEYS[value])}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
