import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ChevronLeftIcon } from 'lucide-react'
import type { BinderCard, BinderDetail, BinderSummary } from '@shared/types'
import { CardArt } from '@/components/CardArt'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { SetProgress } from '@/features/sets/SetProgress'
import { api, queryKeys } from '@/lib/api'
import { cn } from '@/lib/utils'
import { BinderForm } from './BinderForm'
import { BinderView } from './BinderView'
import { GOAL_LABEL, binderProgress, languagesLabel } from './binderProgress'

function Row({ b, onOpen }: { b: BinderSummary; onOpen: () => void }): React.JSX.Element {
  const hasGoal = b.goal !== 'none'
  const progress = binderProgress(b)
  const total = progress.total
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-3 rounded-lg border border-white/[0.08] bg-white/[0.03] p-3 text-left outline-none hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="w-12 shrink-0 overflow-hidden rounded-[3px]">
          {b.coverImageId ? (
            <CardArt imageId={b.coverImageId} size="small" alt="" className="w-full" />
          ) : (
            <div className="aspect-[59/86] bg-white/10" />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="truncate font-semibold">{b.name}</div>
          <div className="truncate text-xs text-muted-foreground">
            {[
              b.hasRules ? 'Rule' : 'Manual',
              GOAL_LABEL[b.goal],
              languagesLabel(b.languages),
              ...(b.friendsVisible ? [] : ['private'])
            ].join(' · ')}
          </div>
          {hasGoal && total > 0 && <SetProgress progress={progress} />}
          {!hasGoal ? (
            <div className="text-xs text-muted-foreground tabular-nums">
              {b.tooBroad
                ? 'Too broad to track'
                : `${b.ownedSlots} ${b.ownedSlots === 1 ? 'card' : 'cards'}`}
            </div>
          ) : total === 0 && !b.tooBroad ? (
            <div className="text-xs text-muted-foreground">Nothing to track yet</div>
          ) : b.tooBroad ? (
            <div className="text-xs text-muted-foreground">Too broad to track</div>
          ) : (
            <div
              className={cn(
                'text-xs tabular-nums',
                progress.complete ? 'text-complete' : 'text-muted-foreground'
              )}
            >
              {progress.complete
                ? 'Complete'
                : `${progress.owned} of ${total} · ${b.missingSlots} missing`}
            </div>
          )}
        </div>
      </button>
    </li>
  )
}

function Open({
  uid,
  onBack,
  onEdit
}: {
  uid: string
  onBack: () => void
  onEdit?: (detail: BinderDetail) => void
}): React.JSX.Element {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: queryKeys.binder(uid), queryFn: () => api.binders.get(uid) })
  // A slot's key is `${level}:${target}`; a pkey holds colons, so split on the first one only.
  const remove = async (card: BinderCard): Promise<void> => {
    const target = card.key.slice(card.key.indexOf(':') + 1)
    try {
      await api.binders.edit(uid, { level: card.level, target }, 'remove')
      // One prefix covers the list, this page and each card's binders.
      await qc.invalidateQueries({ queryKey: queryKeys.binders })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update the binder')
    }
  }
  return (
    <div className="space-y-4 p-8 max-md:p-4">
      <PageHeader>
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeftIcon className="size-4" />
          Binders
        </Button>
      </PageHeader>
      {q.data ? (
        <BinderView
          detail={q.data}
          onEdit={onEdit && (() => q.data && onEdit(q.data))}
          onRemove={(card) => void remove(card)}
        />
      ) : q.isSuccess ? (
        <p className="text-sm text-muted-foreground">This binder no longer exists.</p>
      ) : null}
    </div>
  )
}

/** The current game's binders, with progress; opening one shows its slots. */
export function BindersPage(): React.JSX.Element {
  const list = useQuery({ queryKey: queryKeys.binders, queryFn: () => api.binders.list() })
  const [uid, setUid] = useState<string | null>(null)
  // The form: a binder being edited, or true for a new one.
  const [form, setForm] = useState<BinderDetail | true | null>(null)
  if (form)
    return (
      <BinderForm
        binder={form === true ? undefined : form}
        onCancel={() => setForm(null)}
        onDone={(saved) => {
          setForm(null)
          // A deleted binder goes back to the list; a saved one stays open.
          setUid(saved ?? null)
        }}
      />
    )
  if (uid) return <Open uid={uid} onBack={() => setUid(null)} onEdit={setForm} />
  const binders = list.data ?? []
  return (
    <div className="space-y-4 p-8 max-md:p-4">
      <PageHeader>
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">Binders</h1>
          <Button onClick={() => setForm(true)}>New binder</Button>
        </div>
      </PageHeader>
      {list.isSuccess && binders.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No binders yet. A binder tracks a set of cards you want to collect, such as every artwork
          of one card.
        </p>
      ) : (
        <ul className="space-y-3" aria-label="Binders">
          {binders.map((b) => (
            <Row key={b.uid} b={b} onOpen={() => setUid(b.uid)} />
          ))}
        </ul>
      )}
    </div>
  )
}
