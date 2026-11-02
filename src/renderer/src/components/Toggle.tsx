import SegmentedControl from './SegmentedControl'

const VALUES = ['on', 'off'] as const
const LABEL_KEYS = { on: 'settings.boolean.on', off: 'settings.boolean.off' }

/** Labeled boolean control using the shared glass indicator and keyboard model. */
export default function Toggle({
  checked,
  onChange,
  ariaLabel,
  ariaDescribedBy,
  disabled = false
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  ariaLabel: string
  /** Id of text that explains the setting. */
  ariaDescribedBy?: string
  disabled?: boolean
}): React.JSX.Element {
  return (
    <SegmentedControl
      values={VALUES}
      active={checked ? 'on' : 'off'}
      labelKeys={LABEL_KEYS}
      ariaLabel={ariaLabel}
      ariaDescribedBy={ariaDescribedBy}
      onChange={(value) => onChange(value === 'on')}
      disabled={disabled}
    />
  )
}
