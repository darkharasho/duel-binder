import { useMemo, useState } from 'react'
import { PencilIcon } from 'lucide-react'
import type { BinderCard, BinderDetail } from '@shared/types'
import type { BinderRule } from '@shared/binders'
import { CardSheet } from '@/components/CardSheet'
import { UnderlineTabs } from '@/components/UnderlineTabs'
import { Button } from '@/components/ui/button'
import { SetProgress } from '@/features/sets/SetProgress'
import { CardPanel } from '@/features/card/CardPanel'
import { formatUsd } from '@/lib/format'
import { BinderGrid } from './BinderGrid'
import { GOAL_LABEL, binderProgress, languagesLabel } from './binderProgress'

type View = 'all' | 'owned' | 'missing'
const VIEWS = [
  { value: 'all', label: 'All' },
  { value: 'owned', label: 'Owned' },
  { value: 'missing', label: 'Missing' }
] as const

const ruleText = (r: BinderRule): { label: string; value: string } =>
  r.field === 'name'
    ? { label: 'Name', value: r.op === 'is' ? r.value : `contains ${r.value}` }
    : {
        label: r.field.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()),
        value: r.values.join(', ')
      }

function Chip({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <span className="rounded-full bg-white/[0.06] px-3 py-1 text-xs">
      <span className="text-muted-foreground">{label}</span> {children}
    </span>
  )
}

interface Props {
  detail: BinderDetail
  /** Someone else's binder: no edit or remove controls. */
  readOnly?: boolean
  onEdit?: () => void
  onRemove?: (card: BinderCard) => void
}

/** One binder: its rule, goal and progress, and a grid of its slots. */
export function BinderView({ detail, readOnly, onEdit, onRemove }: Props): React.JSX.Element {
  const [view, setView] = useState<View>('all')
  const [open, setOpen] = useState<BinderCard | null>(null)
  const progress = binderProgress(detail)
  const hasGoal = detail.goal !== 'none'
  const shown = useMemo(
    () =>
      detail.cards.filter((c) =>
        view === 'owned' ? c.owned > 0 : view === 'missing' ? c.owned === 0 : true
      ),
    [detail.cards, view]
  )
  const summary = [
    hasGoal
      ? `${progress.owned} of ${progress.total} · ${detail.missingSlots} missing`
      : `${detail.cards.length} ${detail.cards.length === 1 ? 'card' : 'cards'}`,
    ...(hasGoal && detail.missingSlots > 0 && !detail.tooBroad
      ? [`est. value to finish ${formatUsd(detail.valueToFinish)}`]
      : [])
  ].join(' · ')

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="truncate text-xl font-semibold">{detail.name}</h2>
        {!readOnly &&
          (detail.editable ? (
            onEdit && (
              <Button variant="secondary" size="sm" onClick={onEdit}>
                <PencilIcon className="size-3.5" />
                Edit
              </Button>
            )
          ) : (
            <p className="text-sm text-muted-foreground">Update the app to edit this binder.</p>
          ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {detail.rules.rules.map((r, i) => {
          const t = ruleText(r)
          return (
            <Chip key={i} label={t.label}>
              {t.value}
            </Chip>
          )
        })}
        <Chip label="Goal">{GOAL_LABEL[detail.goal]}</Chip>
        <Chip label="Languages">{languagesLabel(detail.languages)}</Chip>
        <Chip label="Friends">{detail.friendsVisible ? 'can see' : 'cannot see'}</Chip>
      </div>
      {detail.tooBroad ? (
        <p className="text-sm text-muted-foreground">
          This rule matches too many cards to track. Edit it to narrow it down.
        </p>
      ) : (
        <>
          <div className="space-y-2">
            {hasGoal && <SetProgress progress={progress} className="max-w-sm" />}
            <p className="text-sm text-muted-foreground tabular-nums">{summary}</p>
            {hasGoal && detail.unpricedMissing > 0 && (
              <p className="text-xs text-muted-foreground">
                {detail.unpricedMissing} {detail.unpricedMissing === 1 ? 'card has' : 'cards have'}{' '}
                no price
              </p>
            )}
          </div>
          {hasGoal && (
            <UnderlineTabs label="Show" value={view} options={VIEWS} onChange={setView} />
          )}
          {detail.cards.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing in this binder yet. Open a card to add it.
            </p>
          ) : (
            <BinderGrid cards={shown} onOpen={setOpen} onRemove={onRemove} readOnly={readOnly} />
          )}
        </>
      )}
      {open && (
        <CardSheet onClose={() => setOpen(null)}>
          <CardPanel
            cardId={open.card.id}
            printingId={open.printingScan && open.printing ? open.printing.id : null}
            seed={{
              name: open.card.name,
              type: open.card.type,
              imageId: open.imageId,
              price: open.price,
              defaultPrintingId: open.printingScan && open.printing ? open.printing.id : null
            }}
            onClose={() => setOpen(null)}
          />
        </CardSheet>
      )}
    </div>
  )
}
