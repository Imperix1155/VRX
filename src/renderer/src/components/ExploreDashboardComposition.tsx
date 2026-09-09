import type { ReactNode } from 'react'
import ExploreDashboardPreview, {
  type ExploreDashboardPreviewProps
} from './ExploreDashboardPreview'

export interface ExploreDashboardCompositionProps {
  /** Existing Dashboard-owned stat cards; this composition never calculates them. */
  stats: ReactNode
  /** Existing Hot Instances section, retained as an opaque node. */
  hotInstances: ReactNode
  preview: ExploreDashboardPreviewProps
}

/** Phase-A sample composition: stats → shared Popular now cards → Hot Instances. */
export default function ExploreDashboardComposition({
  stats,
  hotInstances,
  preview
}: ExploreDashboardCompositionProps): React.JSX.Element {
  return (
    <>
      {stats}
      <ExploreDashboardPreview {...preview} />
      {hotInstances}
    </>
  )
}
