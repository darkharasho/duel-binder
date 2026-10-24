import { useCallback, useEffect, useState } from 'react'
import type { CardSearchResult } from '@shared/types'
import { AppShell, type NavigateFn, type Page } from '@/components/AppShell'
import { Toaster } from '@/components/ui/sonner'
import { AddCardDialog } from '@/features/add-card/AddCardDialog'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { CollectionPage } from '@/features/collection/CollectionPage'
import { BrowsePage } from '@/features/browse/BrowsePage'
import { SetsPage } from '@/features/sets/SetsPage'
import { SettingsPage } from '@/features/settings/SettingsPage'
import { useDataChanged } from '@/components/useDataChanged'
import { useUpdateToasts } from '@/features/settings/useUpdateToasts'

interface AddInitial {
  card: CardSearchResult
  printingId: number
}

function App(): React.JSX.Element {
  const [page, setPage] = useState<Page>('dashboard')
  const [entryId, setEntryId] = useState<number | undefined>()
  const [addOpen, setAddOpen] = useState(false)
  const [addInitial, setAddInitial] = useState<AddInitial | null>(null)
  useUpdateToasts()
  useDataChanged()

  const openAdd = useCallback((initial: AddInitial | null = null): void => {
    setAddInitial(initial)
    setAddOpen(true)
  }, [])

  const onNavigate: NavigateFn = useCallback((next, opts) => {
    setEntryId(opts?.entryId)
    setPage(next)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        openAdd()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openAdd])

  return (
    <>
      <AppShell page={page} onNavigate={onNavigate} onAddCard={() => openAdd()}>
        {page === 'dashboard' && (
          <DashboardPage onNavigate={onNavigate} onAddCard={() => openAdd()} />
        )}
        {page === 'collection' && (
          <CollectionPage
            key={entryId ?? 'all'}
            initialEntryId={entryId}
            onAddCard={() => openAdd()}
          />
        )}
        {page === 'browse' && (
          <BrowsePage onAddCard={(card, printingId) => openAdd({ card, printingId })} />
        )}
        {page === 'sets' && (
          <SetsPage
            onAddCard={() => openAdd()}
            onAddMissing={(card, printingId) => openAdd({ card, printingId })}
          />
        )}
        {page === 'settings' && <SettingsPage />}
      </AppShell>
      <AddCardDialog open={addOpen} onOpenChange={setAddOpen} initial={addInitial} />
      <Toaster />
    </>
  )
}

export default App
