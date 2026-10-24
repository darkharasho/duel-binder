import { useCallback, useEffect, useState } from 'react'
import { AppShell, type NavigateFn, type Page } from '@/components/AppShell'
import { Toaster } from '@/components/ui/sonner'
import { AddCardDialog } from '@/features/add-card/AddCardDialog'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { CollectionPage } from '@/features/collection/CollectionPage'
import { SettingsPage } from '@/features/settings/SettingsPage'

function App(): React.JSX.Element {
  const [page, setPage] = useState<Page>('dashboard')
  const [entryId, setEntryId] = useState<number | undefined>()
  const [addOpen, setAddOpen] = useState(false)

  const onNavigate: NavigateFn = useCallback((next, opts) => {
    setEntryId(opts?.entryId)
    setPage(next)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setAddOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      <AppShell page={page} onNavigate={onNavigate} onAddCard={() => setAddOpen(true)}>
        {page === 'dashboard' && <DashboardPage onNavigate={onNavigate} />}
        {page === 'collection' && (
          <CollectionPage
            key={entryId ?? 'all'}
            initialEntryId={entryId}
            onAddCard={() => setAddOpen(true)}
          />
        )}
        {page === 'settings' && <SettingsPage />}
      </AppShell>
      <AddCardDialog open={addOpen} onOpenChange={setAddOpen} />
      <Toaster />
    </>
  )
}

export default App
