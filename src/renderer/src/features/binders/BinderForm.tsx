import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  GOALS,
  RULE_FIELDS,
  BINDER_RULES_VERSION,
  draftProblem,
  type BinderDraft,
  type BinderGoal,
  type BinderRule,
  type RuleField
} from '@shared/binders'
import { LANGUAGES, type Language } from '@shared/languages'
import type { BinderDetail, BinderPreview } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/PageHeader'
import { api, queryKeys } from '@/lib/api'
import { useGame } from '@/lib/game'
import { useSetNames } from '@/lib/setLabels'

const PREVIEW_DELAY_MS = 300
const SELECT =
  'h-9 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50'

const FIELD_LABEL = (f: RuleField): string =>
  f.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())

const GOAL_OPTION: Record<BinderGoal, string> = {
  none: 'No goal',
  card: 'One of each card',
  art: 'One of each art',
  printing: 'Every printing'
}

const newRule = (field: RuleField): BinderRule =>
  field === 'name' ? { field, op: 'contains', value: '' } : { field, values: [] }

const complete = (r: BinderRule): boolean =>
  r.field === 'name' ? r.value.trim() !== '' : r.values.length > 0

function ValueRule({
  rule,
  onChange,
  labelOf
}: {
  rule: Exclude<BinderRule, { field: 'name' }>
  onChange: (r: BinderRule) => void
  labelOf: (v: string) => string
}): React.JSX.Element {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const label = FIELD_LABEL(rule.field)
  // Ask after typing pauses, as the preview does.
  const [asked, setAsked] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setAsked(q), PREVIEW_DELAY_MS)
    return () => clearTimeout(timer)
  }, [q])
  const found = useQuery({
    queryKey: [...queryKeys.binders, 'fieldValues', rule.field, asked],
    queryFn: () => api.binders.fieldValues(rule.field, asked),
    enabled: open
  })
  const options = (found.data ?? []).filter((v) => !rule.values.includes(v))
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {rule.values.map((v) => (
          <button
            key={v}
            type="button"
            aria-label={`Remove ${labelOf(v)}`}
            onClick={() => onChange({ ...rule, values: rule.values.filter((x) => x !== v) })}
            className="rounded-full bg-white/[0.08] px-2.5 py-0.5 text-xs hover:bg-white/[0.14]"
          >
            {labelOf(v)} ×
          </button>
        ))}
      </div>
      <Input
        aria-label={`Search ${label}`}
        placeholder={`Search ${label.toLowerCase()}`}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      />
      {open && options.length > 0 && (
        <ul className="max-h-40 overflow-y-auto rounded-md border border-white/[0.08]">
          {options.map((v) => (
            <li key={v}>
              <button
                type="button"
                // Keep the input focused so the list stays up for the next pick.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onChange({ ...rule, values: [...rule.values, v] })}
                className="w-full px-2.5 py-1 text-left text-sm hover:bg-white/[0.08]"
              >
                {labelOf(v)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Creates a binder, or edits `binder`: name, rules, goal, languages and who can see it. */
export function BinderForm({
  binder,
  onDone,
  onCancel
}: {
  binder?: BinderDetail
  /** After a save or delete; the saved binder's uid when there is one. */
  onDone: (uid?: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const { game } = useGame()
  const qc = useQueryClient()
  const setNames = useSetNames('all')
  const [name, setName] = useState(binder?.name ?? '')
  const [rules, setRules] = useState<BinderRule[]>(binder?.rules.rules ?? [])
  const [goal, setGoal] = useState<BinderGoal>(binder?.goal ?? 'none')
  const [languages, setLanguages] = useState<Language[]>(binder?.languages ?? [])
  const [friendsVisible, setFriendsVisible] = useState(binder?.friendsVisible ?? true)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const draft: BinderDraft = {
    ...(binder ? { uid: binder.uid } : {}),
    name: name.trim(),
    rules: { version: BINDER_RULES_VERSION, rules },
    goal,
    languages,
    friendsVisible
  }
  const problem = draftProblem(draft, game)

  // Preview only a rule set with every rule filled in; an incomplete one would be refused.
  const ready = rules.length > 0 && rules.every(complete)
  const previewKey = JSON.stringify([rules, goal, languages])
  const [previewed, setPreviewed] = useState<{ key: string; preview: BinderPreview } | null>(null)
  useEffect(() => {
    if (!ready) return
    let live = true
    const timer = setTimeout(() => {
      const [r, g, l] = JSON.parse(previewKey) as [BinderRule[], BinderGoal, Language[]]
      api.binders
        .preview({
          name: 'Preview',
          rules: { version: BINDER_RULES_VERSION, rules: r },
          goal: g,
          languages: l,
          friendsVisible: true
        })
        .then((preview) => live && setPreviewed({ key: previewKey, preview }))
        // A preview that fails is simply not shown.
        .catch(() => live && setPreviewed(null))
    }, PREVIEW_DELAY_MS)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [ready, previewKey])
  const preview = ready && previewed?.key === previewKey ? previewed.preview : null

  const changeRule = (i: number, r: BinderRule): void =>
    setRules((all) => all.map((x, j) => (j === i ? r : x)))

  const finish = async (uid?: string): Promise<void> => {
    // One prefix covers the list, every binder's page and each card's binders.
    await qc.invalidateQueries({ queryKey: queryKeys.binders })
    onDone(uid)
  }
  const run = async (work: () => Promise<string | undefined>, fail: string): Promise<void> => {
    setBusy(true)
    try {
      await finish(await work())
    } catch (e) {
      toast.error(e instanceof Error ? e.message : fail)
      setBusy(false)
    }
  }

  const blocked =
    problem ??
    (preview?.tooBroad
      ? 'These rules match too many cards to track. Narrow them down to save.'
      : null)

  return (
    <form
      className="space-y-5 p-8 max-md:p-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (!blocked) void run(() => api.binders.save(draft), 'Could not save the binder')
      }}
    >
      <PageHeader>
        <h1 className="text-xl font-semibold">{binder ? 'Edit binder' : 'New binder'}</h1>
      </PageHeader>

      <label className="block space-y-1.5 text-sm">
        <span className="font-medium">Name</span>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </label>

      <section aria-label="Rules" className="space-y-3">
        <h2 className="text-sm font-medium">Rules</h2>
        {rules.map((r, i) => (
          <div key={i} className="space-y-1.5 rounded-lg border border-white/[0.08] p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{FIELD_LABEL(r.field)}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Remove ${FIELD_LABEL(r.field)} rule`}
                onClick={() => setRules((all) => all.filter((_, j) => j !== i))}
              >
                Remove
              </Button>
            </div>
            {r.field === 'name' ? (
              <div className="flex gap-2">
                <select
                  aria-label="Name match"
                  className={SELECT}
                  value={r.op}
                  onChange={(e) => changeRule(i, { ...r, op: e.target.value as 'is' | 'contains' })}
                >
                  <option value="contains">contains</option>
                  <option value="is">is</option>
                </select>
                <Input
                  aria-label="Name value"
                  value={r.value}
                  onChange={(e) => changeRule(i, { ...r, value: e.target.value })}
                />
              </div>
            ) : (
              <ValueRule
                rule={r}
                onChange={(next) => changeRule(i, next)}
                labelOf={r.field === 'set' ? setNames.labelOf : (v) => v}
              />
            )}
          </div>
        ))}
        <select
          aria-label="Add rule"
          className={SELECT}
          value=""
          onChange={(e) => {
            if (e.target.value) setRules((all) => [...all, newRule(e.target.value as RuleField)])
          }}
        >
          <option value="">Add rule · leave empty for a manual binder</option>
          {RULE_FIELDS[game].map((f) => (
            <option key={f} value={f}>
              {FIELD_LABEL(f)}
            </option>
          ))}
        </select>
        {preview && !preview.tooBroad && (
          <p className="text-sm text-muted-foreground tabular-nums">
            {`${preview.printings} ${preview.printings === 1 ? 'printing' : 'printings'} · ${preview.cards} ${preview.cards === 1 ? 'card' : 'cards'} · ${preview.owned} owned`}
          </p>
        )}
      </section>

      <label className="block space-y-1.5 text-sm">
        <span className="font-medium">Goal</span>
        <select
          aria-label="Goal"
          className={`${SELECT} block`}
          value={goal}
          onChange={(e) => setGoal(e.target.value as BinderGoal)}
        >
          {GOALS[game].map((g) => (
            <option key={g} value={g}>
              {GOAL_OPTION[g]}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium">Languages</legend>
        <p className="text-xs text-muted-foreground">None selected means every language.</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {LANGUAGES.map((l) => (
            <label key={l.code} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={languages.includes(l.code)}
                onChange={(e) =>
                  setLanguages((all) =>
                    e.target.checked ? [...all, l.code] : all.filter((x) => x !== l.code)
                  )
                }
              />
              {l.label}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={friendsVisible}
          onChange={(e) => setFriendsVisible(e.target.checked)}
        />
        Friends can see this binder
      </label>

      {blocked && <p className="text-sm text-muted-foreground">{blocked}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={busy || blocked !== null}>
          Save
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        {binder &&
          (confirming ? (
            <>
              <span className="text-sm">Delete this binder?</span>
              <Button
                type="button"
                variant="destructive"
                disabled={busy}
                onClick={() =>
                  void run(
                    async () => api.binders.remove(binder.uid).then(() => undefined),
                    'Could not delete the binder'
                  )
                }
              >
                Confirm delete
              </Button>
              <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
                Keep
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="ghost"
              className="ml-auto text-destructive"
              onClick={() => setConfirming(true)}
            >
              Delete
            </Button>
          ))}
      </div>
    </form>
  )
}
