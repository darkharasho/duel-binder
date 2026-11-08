import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type {
  AdminErrorGroup,
  AdminList,
  AdminMerge,
  AdminPhotos,
  AdminTester,
  AdminTesterBy
} from '@shared/admin'
import { GAMES, type GameId } from '@shared/games'
import { GAME_IDS } from '@shared/games/types'
import { HOLDER_LABELS } from '@shared/training'
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
import { adminKeys, errorText, n, shortWhen } from './adminTabs'
import { ConfirmButton, Grid, Note, Panel } from './parts'

/** The games only listed testers see. */
const TESTER_GAMES = GAME_IDS.filter((id) => GAMES[id].access === 'testers')

const admin = (): NonNullable<typeof api.admin> => {
  if (!api.admin) throw new Error('Admin pages are desktop only')
  return api.admin
}

export function ErrorsTab({ groups }: { groups: AdminErrorGroup[] }): React.JSX.Element {
  return (
    <Panel title="Latest reports (anonymous)">
      {groups.length === 0 && <Note>Nothing reported yet.</Note>}
      {groups.map((g, i) => (
        <details key={i} className="group border-t border-white/[0.06] py-2 first:border-t-0">
          <summary className="cursor-pointer text-[13px] [overflow-wrap:anywhere]">
            <span className="mr-2 font-semibold text-primary">{n(g.count)}×</span>
            {g.message}
          </summary>
          {g.reports.map((r, j) => (
            <div key={j} className="mt-2">
              <p className="text-xs text-muted-foreground">
                {[r.day, r.platform, r.appVersion].join(' · ')}
              </p>
              {r.stack && (
                <pre className="mt-1 whitespace-pre-wrap rounded-md bg-white/[0.04] p-2 font-mono text-[11px] [overflow-wrap:anywhere]">
                  {r.stack}
                </pre>
              )}
            </div>
          ))}
        </details>
      ))}
    </Panel>
  )
}

export function MergesTab({ merges }: { merges: AdminMerge[] }): React.JSX.Element {
  const qc = useQueryClient()
  return (
    <Panel title="Merges">
      {merges.length === 0 ? (
        <Note>No merges to undo.</Note>
      ) : (
        <Grid
          heads={['Closed', 'Into', 'Cards', 'Merged', 'Held until', '']}
          left={2}
          rows={merges.map((m) => ({
            key: m.closedId,
            cells: [
              `@${m.closedUsername}`,
              m.survivorUsername ? `@${m.survivorUsername}` : '–',
              n(m.cards),
              shortWhen(m.mergedAt),
              new Date(m.purgeAfter).toLocaleDateString(),
              <ConfirmButton
                key="undo"
                label="Undo"
                title="Undo this merge?"
                description={`@${m.closedUsername} comes back as its own account, out of @${m.survivorUsername ?? '?'}.`}
                action={async () => {
                  const skipped = await admin().undoMerge(m.closedId)
                  if (skipped.length)
                    toast.warning(
                      `Undone, but these sign-ins could not be given back: ${skipped
                        .map((s) => `${s.provider} ${s.subject}`)
                        .join(', ')}`
                    )
                  else toast.success('Merge undone')
                  await qc.invalidateQueries({ queryKey: adminKeys.merges })
                }}
              />
            ]
          }))}
        />
      )}
    </Panel>
  )
}

/** A one-line add form: its fields, an Add button, and the portal's refusal beside it. */
function Adder({
  children,
  label,
  disabled,
  onAdd
}: {
  children: React.ReactNode
  label: string
  disabled: boolean
  onAdd: () => Promise<void>
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <form
      className="mt-4 flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        setBusy(true)
        setError(null)
        onAdd()
          .catch((err: unknown) => setError(errorText(err)))
          .finally(() => setBusy(false))
      }}
    >
      {children}
      <Button type="submit" size="sm" variant="outline" disabled={busy || disabled}>
        {label}
      </Button>
      {error && (
        <span role="alert" className="text-[13px] text-destructive">
          {error}
        </span>
      )}
    </form>
  )
}

export function TestersTab({ testers }: { testers: AdminTester[] }): React.JSX.Element {
  const qc = useQueryClient()
  const [game, setGame] = useState<GameId>(TESTER_GAMES[0] ?? 'op')
  const [by, setBy] = useState<AdminTesterBy>('username')
  const [name, setName] = useState('')
  const reload = (): Promise<void> => qc.invalidateQueries({ queryKey: adminKeys.testers })
  const who = (t: AdminTester): string =>
    t.username ? `@${t.username}` : (t.discordUsername ?? '?')
  return (
    <Panel title="Testers">
      <div className="space-y-5">
        {TESTER_GAMES.map((g) => {
          const mine = testers.filter((t) => t.game === g)
          return (
            <div key={g}>
              <h3 className="mb-1.5 text-[13px] font-semibold">{GAMES[g].name}</h3>
              {mine.length === 0 ? (
                <Note>No testers yet.</Note>
              ) : (
                <Grid
                  heads={['Account', 'Discord', 'Status', '']}
                  left={3}
                  rows={mine.map((t) => ({
                    key: t.id,
                    cells: [
                      t.username ? `@${t.username}` : '–',
                      t.discordUsername ?? '–',
                      t.userId === null ? 'Pending' : 'Bound',
                      <ConfirmButton
                        key="remove"
                        label="Remove"
                        title={`Remove ${who(t)} from ${GAMES[g].name} testers?`}
                        action={async () => {
                          await admin().removeTester(t.id)
                          await reload()
                        }}
                      />
                    ]
                  }))}
                />
              )}
            </div>
          )
        })}
      </div>
      <Adder
        label="Add"
        disabled={name.trim() === ''}
        onAdd={async () => {
          await admin().addTester(game, by, name)
          setName('')
          await reload()
        }}
      >
        <Select value={game} onValueChange={(v) => setGame(v as GameId)}>
          <SelectTrigger size="sm" aria-label="Game" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TESTER_GAMES.map((g) => (
              <SelectItem key={g} value={g}>
                {GAMES[g].name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={by} onValueChange={(v) => setBy(v as AdminTesterBy)}>
          <SelectTrigger size="sm" aria-label="Find by" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="username">App username</SelectItem>
            <SelectItem value="discordUsername">Discord username</SelectItem>
          </SelectContent>
        </Select>
        <Input
          aria-label="Username"
          placeholder="username"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-8 w-48"
        />
      </Adder>
    </Panel>
  )
}

export function AdminsTab({
  list,
  onRemovedSelf
}: {
  list: AdminList
  onRemovedSelf: () => void
}): React.JSX.Element {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const reload = (): Promise<void> => qc.invalidateQueries({ queryKey: adminKeys.admins })
  const remove = useMutation({
    mutationFn: (userId: number) => admin().removeAdmin(userId)
  })
  return (
    <Panel title="Admins">
      <div className="mb-3">
        <Note>Admin belongs to the account, whichever way it signs in.</Note>
      </div>
      <Grid
        heads={['Account', 'Signs in with', 'Added', '']}
        left={3}
        rows={list.admins.map((a) => {
          const self = a.userId === list.you
          return {
            key: a.userId,
            cells: [
              `@${a.username}${self ? ' (you)' : ''}`,
              a.signIns ? a.signIns.split(',').join(', ') : '–',
              new Date(a.addedAt).toLocaleDateString(),
              // The last admin can't be removed, so the dashboard never locks everyone out.
              list.admins.length > 1 ? (
                <ConfirmButton
                  key="remove"
                  label="Remove"
                  title={`Remove ${self ? 'yourself' : `@${a.username}`} from admins?`}
                  description={self ? "You won't see the admin pages after this." : undefined}
                  action={async () => {
                    await remove.mutateAsync(a.userId)
                    if (self) onRemovedSelf()
                    else await reload()
                  }}
                />
              ) : null
            ]
          }
        })}
      />
      <Adder
        label="Add admin"
        disabled={name.trim() === ''}
        onAdd={async () => {
          await admin().addAdmin(name)
          setName('')
          await reload()
        }}
      >
        <Input
          aria-label="App username"
          placeholder="app username"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-8 w-48"
        />
      </Adder>
    </Panel>
  )
}

export function PhotosTab({ photos: s }: { photos: AdminPhotos }): React.JSX.Element {
  if (s.games.length === 0)
    return (
      <Panel title="Photos">
        <Note>No photos yet.</Note>
      </Panel>
    )
  return (
    <div className="grid gap-4">
      {s.games.map((g) => (
        <Panel key={g.game} title={GAMES[g.game as GameId]?.name ?? g.game}>
          <div className="space-y-5">
            <Grid
              heads={['Photos', 'Testers', 'Cards', 'Versions']}
              left={0}
              rows={[{ key: 'all', cells: [n(g.photos), n(g.testers), n(g.cards), n(g.versions)] }]}
            />
            <div>
              <h3 className="mb-1.5 text-[13px] font-semibold">By tester</h3>
              <Grid
                heads={['Tester', 'Photos', 'Last 24 h', 'Last photo']}
                rows={s.testers
                  .filter((t) => t.game === g.game)
                  .map((t) => ({
                    key: t.userId,
                    cells: [t.username, n(t.photos), n(t.today), shortWhen(t.lastAt)]
                  }))}
              />
            </div>
            <div>
              <h3 className="mb-1.5 text-[13px] font-semibold">By holder</h3>
              <Grid
                heads={['Holder', 'Photos', 'Versions']}
                rows={s.holders
                  .filter((h) => h.game === g.game)
                  .map((h) => ({
                    key: h.holder,
                    cells: [
                      HOLDER_LABELS[h.holder as keyof typeof HOLDER_LABELS] ?? h.holder,
                      n(h.photos),
                      n(h.versions)
                    ]
                  }))}
              />
            </div>
          </div>
        </Panel>
      ))}
    </div>
  )
}
