import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Language } from '@shared/languages'
import type { CountMode, Friend, SetSummary } from '@shared/types'
import { PageHeader } from '@/components/PageHeader'
import { SearchInput } from '@/components/SearchInput'
import { Button } from '@/components/ui/button'
import { api, queryKeys } from '@/lib/api'
import { matchesSetSearch } from '@/lib/filters'
import { friendsErrorMessage } from '@/lib/friends'
import { matchesLanguage, useLanguageFilter } from '@/lib/languageFilter'
import { isPhone } from '@/lib/platform'
import { SetChecklist } from '../sets/SetChecklist'
import { SetsList } from '../sets/SetsList'

const share = (s: SetSummary): number => (s.totalCards > 0 ? s.ownedCards / s.totalCards : 0)

/** The sets a friend has started, closest to complete first; a set opens read-only. */
export function FriendSets({
  friend,
  header
}: {
  friend: Friend
  header: React.ReactNode
}): React.JSX.Element {
  const name = friend.displayName ?? friend.username
  const [mode, setMode] = useState<CountMode>('cards')
  const [open, setOpen] = useState<{ setName: string; language: Language } | null>(null)
  const [language] = useLanguageFilter()
  const [q, setQ] = useState('')
  const sets = useQuery({
    queryKey: queryKeys.friendSets(friend.id),
    queryFn: () => api.friends.sets(friend.id),
    retry: false
  })
  const started = useMemo(
    () =>
      (sets.data ?? [])
        .filter((s) => s.ownedCards > 0 && matchesLanguage(language, s.language))
        .sort((a, b) => share(b) - share(a) || b.ownedCards - a.ownedCards),
    [sets.data, language]
  )

  const shown = useMemo(() => started.filter((s) => matchesSetSearch(s, q)), [started, q])

  if (open) {
    return (
      <SetChecklist
        {...open}
        mode={mode}
        onModeChange={setMode}
        onBack={() => setOpen(null)}
        friend={friend}
        friendHeader={header}
      />
    )
  }
  return (
    <div className="space-y-4 p-8 max-md:p-4">
      <PageHeader>
        {header}
        {started.length > 0 && (
          <SearchInput
            label="Search sets"
            placeholder="Search sets by name or code"
            value={q}
            onChange={setQ}
          />
        )}
      </PageHeader>
      {sets.isError && !sets.data && (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-muted-foreground">
            {friendsErrorMessage(sets.error)}
          </p>
          <Button variant="outline" onClick={() => void sets.refetch()}>
            Retry
          </Button>
        </div>
      )}
      {sets.data && started.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {name} hasn&apos;t started any sets in this game.
        </p>
      )}
      {started.length > 0 && shown.length === 0 && (
        <p className="text-sm text-muted-foreground">No sets match</p>
      )}
      <SetsList
        sets={shown}
        mode={mode}
        view={isPhone() ? 'list' : 'grid'}
        onOpen={(setName, language) => setOpen({ setName, language })}
        label={`${name}'s sets`}
      />
    </div>
  )
}
