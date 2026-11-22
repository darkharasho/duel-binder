import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { AdminTerm, AdminTermFields } from '@shared/admin'
import { GAMES, type GameId } from '@shared/games'
import { GAME_IDS } from '@shared/games/types'
import type { TermKind, TermTarget, TermTargetKind } from '@shared/search/terms'
import { CardArt } from '@/components/CardArt'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { api } from '@/lib/api'
import { ADMIN_QUERY, adminKeys, errorText } from './adminTabs'
import { ConfirmButton, Failed, Note, Panel } from './parts'

const KINDS: TermKind[] = ['nickname', 'abbreviation', 'subset', 'rarity', 'cards']
const TARGET_KINDS: TermTargetKind[] = ['printing', 'card', 'set', 'rarity', 'cards']

function admin(): NonNullable<typeof api.admin> {
  if (!api.admin) throw new Error('Admin pages are desktop only')
  return api.admin
}

const list = (s: string): string[] =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)

/** A term's target as the form's four comma lists (a set is `language:Set name`). */
function targetText(t: TermTarget): Record<'pkeys' | 'cardIds' | 'sets' | 'rarities', string> {
  return {
    pkeys: (t.pkeys ?? []).join(', '),
    cardIds: (t.cardIds ?? []).join(', '),
    sets: (t.sets ?? []).map((s) => `${s.language}:${s.setName}`).join(', '),
    rarities: (t.rarities ?? []).join(', ')
  }
}

function targetFrom(f: ReturnType<typeof targetText>): TermTarget {
  const target: TermTarget = {}
  const pkeys = list(f.pkeys)
  const cardIds = list(f.cardIds).map(Number)
  const sets = list(f.sets).map((s) => {
    const i = s.indexOf(':')
    const language = s.slice(0, i).trim()
    const setName = s.slice(i + 1).trim()
    if (i <= 0 || !language || !setName) throw new Error(SETS_HINT)
    return { language, setName }
  })
  const rarities = list(f.rarities)
  if (pkeys.length) target.pkeys = pkeys
  if (cardIds.length) target.cardIds = cardIds
  if (sets.length) target.sets = sets
  if (rarities.length) target.rarities = rarities
  return target
}

const SETS_HINT = 'Sets need language:Set name'

const EMPTY: AdminTermFields = { phrase: '', kind: 'nickname', targetKind: 'card', target: {} }

/** The fields of a term: phrase, kind, target kind and the target's comma lists. */
function TermForm({
  initial,
  label,
  onSubmit,
  onCancel
}: {
  initial: AdminTermFields
  label: string
  onSubmit: (fields: AdminTermFields) => Promise<void>
  onCancel?: () => void
}): React.JSX.Element {
  const [phrase, setPhrase] = useState(initial.phrase)
  const [kind, setKind] = useState<TermKind>(initial.kind)
  const [targetKind, setTargetKind] = useState<TermTargetKind>(initial.targetKind)
  const [text, setText] = useState(targetText(initial.target))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const field = (key: keyof typeof text, name: string): React.JSX.Element => (
    <Input
      aria-label={name}
      placeholder={name}
      className="h-8 w-56 text-[13px]"
      value={text[key]}
      onChange={(e) => setText({ ...text, [key]: e.target.value })}
    />
  )
  return (
    <form
      className="mt-2 flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        setError(null)
        let target: TermTarget
        try {
          target = targetFrom(text)
        } catch (err) {
          setError(errorText(err))
          return
        }
        setBusy(true)
        onSubmit({ phrase, kind, targetKind, target })
          .catch((err: unknown) => setError(errorText(err)))
          .finally(() => setBusy(false))
      }}
    >
      <Input
        aria-label="Phrase"
        placeholder="Phrase"
        className="h-8 w-44 text-[13px]"
        value={phrase}
        onChange={(e) => setPhrase(e.target.value)}
      />
      <Select value={kind} onValueChange={(v) => setKind(v as TermKind)}>
        <SelectTrigger size="sm" aria-label="Kind" className="w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {KINDS.map((k) => (
            <SelectItem key={k} value={k}>
              {k}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={targetKind} onValueChange={(v) => setTargetKind(v as TermTargetKind)}>
        <SelectTrigger size="sm" aria-label="Target kind" className="w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {TARGET_KINDS.map((k) => (
            <SelectItem key={k} value={k}>
              {k}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {field('pkeys', 'Printing keys')}
      {field('cardIds', 'Card ids')}
      {field('sets', 'Sets (language:name)')}
      {field('rarities', 'Rarities')}
      <Button type="submit" size="sm" disabled={busy || phrase.trim() === ''}>
        {label}
      </Button>
      {onCancel && (
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      )}
      {error && (
        <span role="alert" className="basis-full text-[13px] text-destructive">
          {error}
        </span>
      )}
    </form>
  )
}

function TermCard({
  term,
  onDecide
}: {
  term: AdminTerm
  onDecide: (status: 'approved' | 'rejected', edit?: AdminTermFields) => Promise<void>
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const decide = (status: 'approved' | 'rejected'): void => {
    setError(null)
    onDecide(status).catch((e: unknown) => setError(errorText(e)))
  }
  const { evidence, preview } = term
  const pending = term.status === 'pending'
  return (
    <li className="flex gap-3 border-t border-white/[0.06] py-3 first:border-t-0">
      {preview?.imageId != null && (
        <CardArt
          imageId={preview.imageId}
          size="small"
          alt={preview.cardName}
          className="h-fit w-14 shrink-0 rounded-[3px]"
        />
      )}
      <div className="min-w-0 flex-1 space-y-1 text-[13px]">
        <p>
          <span className="font-semibold">{term.phrase}</span>{' '}
          <span className="text-muted-foreground">
            {term.kind} · {term.targetKind}
          </span>
        </p>
        <p className="text-muted-foreground">
          {preview?.label ?? 'No card found for this target.'}
        </p>
        {pending && (
          <>
            {evidence.reason && <p>{evidence.reason}</p>}
            <p className="text-muted-foreground">
              {evidence.count} listings, {evidence.sellers} sellers
            </p>
            {evidence.titles.length > 0 && (
              <ul className="list-disc pl-4 text-xs text-muted-foreground">
                {evidence.titles.slice(0, 5).map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            )}
          </>
        )}
        <div className="flex gap-1.5 pt-1">
          {pending ? (
            <>
              <Button size="sm" onClick={() => decide('approved')}>
                Approve
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(!editing)}>
                Edit
              </Button>
              <ConfirmButton
                label="Reject"
                title={`Reject "${term.phrase}"?`}
                description="It leaves the Pending list. You can restore it from the Rejected list."
                action={() => onDecide('rejected')}
              />
            </>
          ) : term.status === 'approved' ? (
            <ConfirmButton
              label="Remove"
              title={`Remove "${term.phrase}"?`}
              description="Searches stop using it. You can restore it from the Rejected list."
              confirmLabel="Remove"
              action={() => onDecide('rejected')}
            />
          ) : (
            <Button size="sm" variant="outline" onClick={() => decide('approved')}>
              Restore
            </Button>
          )}
        </div>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {editing && (
          <TermForm
            initial={term}
            label="Save and approve"
            onCancel={() => setEditing(false)}
            onSubmit={(fields) => onDecide('approved', fields)}
          />
        )}
      </div>
    </li>
  )
}

/** The community search terms: pending proposals to approve, edit or reject, the approved list, and rejected ones to restore. */
export function TermsTab(): React.JSX.Element {
  const qc = useQueryClient()
  const [game, setGame] = useState<GameId>('ygo')
  const keyOf = (status: AdminTerm['status']): readonly unknown[] => adminKeys.terms(game, status)
  const pending = useQuery({
    queryKey: keyOf('pending'),
    queryFn: () => admin().terms(game, 'pending'),
    ...ADMIN_QUERY
  })
  const approved = useQuery({
    queryKey: keyOf('approved'),
    queryFn: () => admin().terms(game, 'approved'),
    ...ADMIN_QUERY
  })
  const rejected = useQuery({
    queryKey: keyOf('rejected'),
    queryFn: () => admin().terms(game, 'rejected'),
    ...ADMIN_QUERY
  })
  const without = (key: readonly unknown[], id: number): void =>
    void qc.setQueryData<AdminTerm[]>(key, (old) => old?.filter((t) => t.id !== id))
  const decide = async (
    term: AdminTerm,
    status: 'approved' | 'rejected',
    edit?: AdminTermFields
  ): Promise<void> => {
    await admin().decideTerm(term.id, status, edit)
    without(keyOf(term.status), term.id)
    await qc.invalidateQueries({ queryKey: keyOf(status) })
  }
  const list = (q: typeof pending, empty: string): React.JSX.Element =>
    q.isError ? (
      <Failed error={q.error} />
    ) : !q.isSuccess ? (
      <Note>Loading…</Note>
    ) : q.data.length === 0 ? (
      <Note>{empty}</Note>
    ) : (
      <ul>
        {q.data.map((t) => (
          <TermCard key={t.id} term={t} onDecide={(s, e) => decide(t, s, e)} />
        ))}
      </ul>
    )
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={game} onValueChange={(v) => setGame(v as GameId)}>
          <SelectTrigger size="sm" aria-label="Game" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {GAME_IDS.map((g) => (
              <SelectItem key={g} value={g}>
                {GAMES[g].name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Panel title="Pending">{list(pending, 'Nothing waiting.')}</Panel>
      <Panel title="Approved">{list(approved, 'No approved terms yet.')}</Panel>
      <Panel title="Rejected">{list(rejected, 'Nothing rejected or removed.')}</Panel>
      <Panel title="Add term">
        <TermForm
          initial={EMPTY}
          label="Add term"
          onSubmit={async (fields) => {
            await admin().addTerm(game, fields)
            toast.success(`Added "${fields.phrase.trim()}"`)
            await qc.invalidateQueries({ queryKey: keyOf('approved') })
          }}
        />
      </Panel>
    </div>
  )
}
