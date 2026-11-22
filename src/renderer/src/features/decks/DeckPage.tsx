import { useQuery } from '@tanstack/react-query'
import { ChevronLeftIcon } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { PAGE_TITLE } from '@/components/pageHeaderContext'
import { Button } from '@/components/ui/button'
import { api, queryKeys } from '@/lib/api'
import { useBackHandler } from '@/lib/backStack'

/** A placeholder: the deck page proper replaces this. */
export function DeckPage({ uid, onBack }: { uid: string; onBack: () => void }): React.JSX.Element {
  useBackHandler(true, onBack)
  const q = useQuery({ queryKey: queryKeys.deck(uid), queryFn: () => api.decks.get(uid) })
  return (
    <div className="space-y-4 p-8 max-md:p-4">
      <PageHeader>
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" className="-ml-2 shrink-0" onClick={onBack}>
            <ChevronLeftIcon className="size-4" />
            Back
          </Button>
          <h1 className={PAGE_TITLE}>{q.data?.name ?? ''}</h1>
        </div>
      </PageHeader>
    </div>
  )
}
