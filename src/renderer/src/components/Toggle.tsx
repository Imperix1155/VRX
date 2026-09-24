import SegmentedControl from './SegmentedControl'

const VALUES = ['on', 'off'] as const
const LABEL_KEYS = { on: 'settings.boolean.on', off: 'settings.boolean.off' }

/** Labeled boolean control using the shared glass indicator and keyboard model. */
export default function Toggle({
  checked,
  onChange,
  ariaLabel
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  ariaLabel: string
}): React.JSX.Element {
  return (
    <SegmentedControl
      values={VALUES}
      active={checked ? 'on' : 'off'}
      labelKeys={LABEL_KEYS}
      ariaLabel={ariaLabel}
      onChange={(value) => onChange(value === 'on')}
    />
  )
}
