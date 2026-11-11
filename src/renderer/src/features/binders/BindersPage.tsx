import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ChevronLeftIcon } from 'lucide-react'
import type { BinderCard, BinderDetail, BinderSummary } from '@shared/types'
import { reverseLook } from '@shared/reverseHolo'
import { CardArt } from '@/components/CardArt'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { SetProgress } from '@/features/sets/SetProgress'
import { api, queryKeys } from '@/lib/api'
import { useBackHandler } from '@/lib/backStack'
import { cn } from '@/lib/utils'
import { binderStyle } from './binderColour'
import { BinderForm } from './BinderForm'
import './binderLook.css'
import { BinderView } from './BinderView'
import { GOAL_LABEL, binderProgress, languagesLabel } from './binderProgress'

/** The list's layout: binders stood side by side like a shelf. */
export const SHELF =
  'grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-x-8 gap-y-10 max-md:grid-cols-2 max-md:gap-x-4 max-md:gap-y-8'

export function Row({ b, onOpen }: { b: BinderSummary; onOpen: () => void }): React.JSX.Element {
  const hasGoal = b.goal !== 'none'
  const progress = binderProgress(b)
  const total = progress.total
  const complete = hasGoal && !b.tooBroad && progress.complete
  return (
    <li className="min-w-0">
      <button
        type="button"
        onClick={onOpen}
        className="group/cover block w-full rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background"
      >
        <div className="binder-cover binder-leather" style={binderStyle(b.uid)}>
          <div className="binder-window">
            {b.coverImageId ? (
              <CardArt
                imageId={b.coverImageId}
                printingId={b.coverPrintingId}
                reverse={
                  b.coverReverse &&
                  reverseLook(b.coverReverse.finish, b.coverReverse.setCode, b.coverReverse)
                }
                size="small"
                alt=""
                className="w-full rounded-[2px]"
              />
            ) : (
              <div className="aspect-[59/86] rounded-[2px] bg-white/5" />
            )}
          </div>
          <div className="binder-title" data-foil={complete}>
            {b.name}
          </div>
          {complete && <div className="binder-ribbon" aria-hidden />}
        </div>
        <div className="mt-5 min-w-0 space-y-1.5 px-1">
          {hasGoal && total > 0 && <SetProgress progress={progress} />}
          {!hasGoal ? (
            <div className="text-xs tabular-nums">
              {b.tooBroad
                ? 'Too broad to track'
                : `${b.ownedSlots} ${b.ownedSlots === 1 ? 'card' : 'cards'}`}
            </div>
          ) : total === 0 && !b.tooBroad ? (
            <div className="text-xs text-muted-foreground">Nothing to track yet</div>
          ) : b.tooBroad ? (
            <div className="text-xs text-muted-foreground">Too broad to track</div>
          ) : (
            <div className={cn('text-xs tabular-nums', progress.complete && 'text-complete')}>
              {progress.complete
                ? 'Complete'
                : `${progress.owned} of ${total} · ${b.missingSlots} missing`}
            </div>
          )}
          <div className="truncate text-xs text-muted-foreground">
            {[
              b.hasRules ? 'Rule' : 'Manual',
              ...(b.editable
                ? [GOAL_LABEL[b.goal], languagesLabel(b.languages)]
                : ['needs a newer app']),
              ...(b.friendsVisible ? [] : ['private'])
            ].join(' · ')}
          </div>
        </div>
      </button>
    </li>
  )
}

/** Back to the binders list, at the start of an open binder's name line. */
export function BackToBinders({ onBack }: { onBack: () => void }): React.JSX.Element {
  return (
    <Button variant="ghost" size="sm" className="-ml-2 -mr-1 shrink-0" onClick={onBack}>
      <ChevronLeftIcon className="size-4" />
      Binders
    </Button>
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
  useBackHandler(true, onBack)
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
      {q.data ? (
        <BinderView
          detail={q.data}
          titleBar
          back={<BackToBinders onBack={onBack} />}
          onEdit={onEdit && (() => q.data && onEdit(q.data))}
          onRemove={(card) => void remove(card)}
        />
      ) : (
        <>
          <PageHeader>
            <BackToBinders onBack={onBack} />
          </PageHeader>
          {q.isSuccess && (
            <p className="text-sm text-muted-foreground">This binder no longer exists.</p>
          )}
        </>
      )}
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
        <ul className={SHELF} aria-label="Binders">
          {binders.map((b) => (
            <Row key={b.uid} b={b} onOpen={() => setUid(b.uid)} />
          ))}
        </ul>
      )}
    </div>
  )
}
