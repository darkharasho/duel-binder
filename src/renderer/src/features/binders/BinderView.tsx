import { useMemo, useState } from 'react'
import { PencilIcon } from 'lucide-react'
import type { BinderCard, BinderDetail } from '@shared/types'
import type { BinderRule } from '@shared/binders'
import { CardSheet } from '@/components/CardSheet'
import { PageHeader } from '@/components/PageHeader'
import { binderScanFor } from '@/components/scanFor'
import { UnderlineTabs } from '@/components/UnderlineTabs'
import { Button } from '@/components/ui/button'
import { SetProgress } from '@/features/sets/SetProgress'
import { CardPanel } from '@/features/card/CardPanel'
import { SortControl } from '@/components/SortControl'
import { formatUsd } from '@/lib/format'
import { useGame } from '@/lib/game'
import { isWeb } from '@/lib/platform'
import { BinderGrid } from './BinderGrid'
import { BinderPlaceholdersButton } from './BinderPlaceholders'
import { GOAL_LABEL, binderProgress, languagesLabel } from './binderProgress'
import {
  binderSorts,
  readBinderOrder,
  saveBinderOrder,
  sortBinderCards,
  type BinderOrder
} from './binderSort'

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
  /** A back button, at the start of the name's line. */
  back?: React.ReactNode
  /** The name's line is the page's pinned title bar (the page has no header of its own). */
  titleBar?: boolean
}

/** One binder: its rule, goal and progress, and a grid of its slots. */
export function BinderView({
  detail,
  readOnly,
  onEdit,
  onRemove,
  back,
  titleBar
}: Props): React.JSX.Element {
  const [view, setView] = useState<View>('all')
  const [open, setOpen] = useState<BinderCard | null>(null)
  const { game } = useGame()
  const [order, setOrder] = useState<{ uid: string; order: BinderOrder }>(() => ({
    uid: detail.uid,
    order: readBinderOrder(detail.uid, detail.goal)
  }))
  // Another binder opened in the same view reads its own saved order.
  const current = order.uid === detail.uid ? order.order : readBinderOrder(detail.uid, detail.goal)
  const sorts = binderSorts(detail.goal)
  const chooseOrder = (o: BinderOrder): void => {
    setOrder({ uid: detail.uid, order: o })
    saveBinderOrder(detail.uid, o)
  }
  const progress = binderProgress(detail)
  const hasGoal = detail.goal !== 'none'
  const sorted = useMemo(
    () => sortBinderCards(detail.cards, current, game),
    [detail.cards, current, game]
  )
  const shown = useMemo(
    () =>
      sorted.filter((c) =>
        view === 'owned' ? c.owned > 0 : view === 'missing' ? c.owned === 0 : true
      ),
    [sorted, view]
  )
  const summary = [
    hasGoal && progress.total === 0
      ? 'Nothing to track yet'
      : hasGoal
        ? `${progress.owned} of ${progress.total} · ${detail.missingSlots} missing`
        : `${detail.cards.length} ${detail.cards.length === 1 ? 'card' : 'cards'}`,
    ...(hasGoal && detail.missingSlots > 0 && !detail.tooBroad
      ? [`est. value to finish ${formatUsd(detail.valueToFinish)}`]
      : [])
  ].join(' · ')

  const chips = (
    <>
      {detail.rules.rules.map((r, i) => {
        const t = ruleText(r)
        return (
          <Chip key={i} label={t.label}>
            {t.value}
          </Chip>
        )
      })}
      {detail.editable && (
        <>
          <Chip label="Goal">{GOAL_LABEL[detail.goal]}</Chip>
          <Chip label="Languages">{languagesLabel(detail.languages)}</Chip>
        </>
      )}
      {!readOnly && <Chip label="Friends">{detail.friendsVisible ? 'can see' : 'cannot see'}</Chip>}
    </>
  )

  // The first of two lines above the binder: name and rules; progress and the Show tabs follow.
  const nameLine = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {back}
      <h2 className="min-w-0 max-w-[40%] shrink-0 truncate text-xl font-semibold max-md:max-w-[75%]">
        {detail.name}
      </h2>
      {/* On a phone the rules wrap to their own line under the name. */}
      <div className="order-last flex w-full flex-wrap gap-2 md:order-none md:w-auto md:min-w-0 md:flex-1">
        {chips}
      </div>
      {!readOnly &&
        (detail.editable ? (
          onEdit && (
            <Button variant="secondary" size="sm" className="ml-auto shrink-0" onClick={onEdit}>
              <PencilIcon className="size-3.5" />
              Edit
            </Button>
          )
        ) : (
          <p className="ml-auto shrink-0 text-sm text-muted-foreground">
            Update the app to edit this binder.
          </p>
        ))}
    </div>
  )

  return (
    <div className="space-y-3">
      {titleBar ? <PageHeader>{nameLine}</PageHeader> : nameLine}
      {detail.tooBroad ? (
        <p className="text-sm text-muted-foreground">
          This rule matches too many cards to track.
          {!readOnly && ' Edit it to narrow it down.'}
        </p>
      ) : (
        <>
          {/* Progress and the Show tabs share a row, so the binder below gets the height. */}
          <div className="@container flex flex-wrap items-center justify-between gap-x-8 gap-y-3">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
              {hasGoal && progress.total > 0 && (
                <SetProgress progress={progress} className="w-40 shrink-0" />
              )}
              <p className="text-sm text-muted-foreground tabular-nums">
                {summary}
                {hasGoal && detail.unpricedMissing > 0 && (
                  <span className="text-xs">
                    {' · '}
                    <span>
                      {detail.unpricedMissing}{' '}
                      {detail.unpricedMissing === 1 ? 'card has' : 'cards have'} no price
                    </span>
                  </span>
                )}
              </p>
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-3">
              {hasGoal && (
                <UnderlineTabs
                  label="Show"
                  value={view}
                  options={VIEWS}
                  onChange={setView}
                  className="-mb-2"
                />
              )}
              {detail.cards.length > 1 && (
                <SortControl
                  options={sorts}
                  value={current.by}
                  dir={current.dir}
                  onChange={(by, dir) => chooseOrder({ by, dir })}
                />
              )}
              {!readOnly && !isWeb() && detail.cards.length > 0 && (
                <BinderPlaceholdersButton detail={detail} cards={sorted} />
              )}
            </div>
          </div>
          {detail.cards.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing in this binder yet.
              {!readOnly && ' Open a card to add it.'}
            </p>
          ) : (
            <BinderGrid
              // A new filter or order starts again from the first page.
              resetKey={`${view}:${current.by}:${current.dir}`}
              uid={detail.uid}
              cards={shown}
              onOpen={setOpen}
              onRemove={onRemove}
              readOnly={readOnly}
              markComplete={hasGoal}
            />
          )}
        </>
      )}
      {open && (
        <CardSheet onClose={() => setOpen(null)}>
          <CardPanel
            cardId={open.card.id}
            printingId={binderScanFor(open)}
            seed={{
              name: open.card.name,
              type: open.card.type,
              imageId: open.imageId,
              price: open.price,
              defaultPrintingId: binderScanFor(open)
            }}
            onClose={() => setOpen(null)}
          />
        </CardSheet>
      )}
    </div>
  )
}
