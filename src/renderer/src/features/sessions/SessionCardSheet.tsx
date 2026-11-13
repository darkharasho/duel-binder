import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { ScanSessionCard } from '@shared/scanSessions'
import { CardSheet } from '@/components/CardSheet'
import { Button } from '@/components/ui/button'
import { CardPanel } from '@/features/card/CardPanel'
import { api } from '@/lib/api'

/**
 * The usual card panel over a session's card, opened on the printing that was added. Given the
 * owner's session (`sessionUid`), it also offers to take the card out of that session, for a stray
 * scan: the session's history changes, the collection doesn't.
 */
export function SessionCardSheet({
  card,
  sessionUid,
  onClose
}: {
  card: ScanSessionCard
  sessionUid?: string
  onClose: () => void
}): React.JSX.Element {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const remove = async (uid: string): Promise<void> => {
    setBusy(true)
    try {
      await api.sessions.removeCard(uid, {
        pkey: card.pkey,
        imageId: card.imageId,
        addedAt: card.addedAt
      })
      await qc.invalidateQueries({ queryKey: ['sessions'] })
      toast.success('Removed from the session. Your collection is unchanged.')
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not remove the card')
      setBusy(false)
    }
  }
  return (
    <CardSheet onClose={onClose}>
      <CardPanel
        cardId={card.cardId}
        printingId={card.printingId}
        seed={{
          name: card.name,
          // The panel fills the type line in from the card it fetches.
          type: '',
          imageId: card.imageId,
          price: card.price,
          defaultPrintingId: card.printingId
        }}
        onClose={onClose}
      />
      {sessionUid && (
        <div className="border-t border-white/[0.06] px-4 pb-6 pt-4">
          <Button
            variant="ghost"
            className="w-full text-destructive hover:text-destructive"
            disabled={busy}
            onClick={() => void remove(sessionUid)}
          >
            {card.quantity > 1 ? 'Remove one copy from this session' : 'Remove from this session'}
          </Button>
          <p className="mt-1 text-center text-xs text-muted-foreground">
            For a stray scan. Your collection stays as it is.
          </p>
        </div>
      )}
    </CardSheet>
  )
}
