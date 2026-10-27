import { useState } from 'react'
import { PageHeader } from '@/components/PageHeader'
import { UnderlineTabs } from '@/components/UnderlineTabs'
import { api } from '@/lib/api'
import type { RipSet } from '../../../../shared/rip/types'
import { PackOpener } from './PackOpener'
import { SetPicker } from './SetPicker'

type Tab = 'open' | 'history'
const TABS = [
  { value: 'open', label: 'Open packs' },
  { value: 'history', label: 'History' }
] as const

/** Picking a set, opening its packs, and (Task 8) the summary after the last one. */
type View =
  | { kind: 'picker' }
  | { kind: 'opening'; sessionId: number; set: RipSet; packCount: number }
  | { kind: 'summary'; sessionId: number; set: RipSet; packCount: number }

export function RipPage(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('open')
  const [view, setView] = useState<View>({ kind: 'picker' })
  const [lastSetName, setLastSetName] = useState<string | null>(null)

  const start = async (set: RipSet, packCount: number): Promise<void> => {
    const sessionId = await api.rip.start(set.setName, packCount)
    setLastSetName(set.setName)
    setView({ kind: 'opening', sessionId, set, packCount })
  }

  return (
    <div className="space-y-5 p-8 max-md:p-4">
      <PageHeader>
        <h1 className="text-2xl font-semibold tracking-tight">Rip</h1>
        <UnderlineTabs
          label="Rip view"
          value={tab}
          options={TABS}
          onChange={setTab}
          className="border-b border-white/[0.08]"
        />
      </PageHeader>
      {tab === 'history' ? (
        <p className="text-sm text-muted-foreground">Your rip history will show up here.</p>
      ) : view.kind === 'opening' ? (
        <PackOpener
          key={view.sessionId}
          sessionId={view.sessionId}
          packCount={view.packCount}
          setName={view.set.setName}
          // Task 8 shows the summary here; for now go back to the picker.
          onDone={() => setView({ kind: 'picker' })}
        />
      ) : (
        <SetPicker onRip={start} initialSetName={lastSetName} />
      )}
    </div>
  )
}
