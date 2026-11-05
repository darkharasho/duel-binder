import type { ScanSessionCard } from '@shared/scanSessions'
import { CardSheet } from '@/components/CardSheet'
import { CardPanel } from '@/features/card/CardPanel'

/** The usual card panel over a session's card, opened on the printing that was added. */
export function SessionCardSheet({
  card,
  onClose
}: {
  card: ScanSessionCard
  onClose: () => void
}): React.JSX.Element {
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
    </CardSheet>
  )
}
