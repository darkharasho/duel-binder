import { toast } from 'sonner'
import { toYdk, toYdke, toYgoText } from '@shared/decks/ygo/lists'
import type { DeckCard, DeckEntry } from '@shared/decks/types'
import { api } from '@/lib/api'
import { errorMessage } from '@/lib/errorMessage'
import { isWeb } from '@/lib/platform'
import { saveTextFile } from '../scan/replay/save'

/** A file name the save dialog and the share sheet both accept, from the deck's name. */
export function ydkFileName(deckName: string): string {
  const base = deckName
    .replace(/[^\w.-]+/g, '_')
    .replace(/^[._]+|_+$/g, '')
    .slice(0, 60)
  return `${base || 'deck'}.ydk`
}

/** The system clipboard: the desktop's own bridge there, the browser's on the web and phone. */
async function copyText(text: string): Promise<void> {
  if (isWeb()) await navigator.clipboard.writeText(text)
  else await api.dex.copy(text)
}

export type ExportKind = 'text' | 'link' | 'ydk'

/** Runs one export of the deck and says how it went. */
export async function exportDeck(
  kind: ExportKind,
  name: string,
  cards: DeckEntry[],
  facts: Record<number, DeckCard>
): Promise<void> {
  try {
    if (kind === 'ydk') {
      const r = await saveTextFile(toYdk(cards), ydkFileName(name), 'text/plain')
      if (r.saved) toast.success(r.where ? `Saved ${r.where}` : 'Saved the deck file')
      return
    }
    await copyText(kind === 'text' ? toYgoText(cards, facts) : toYdke(cards))
    toast.success(kind === 'text' ? 'Copied the deck list' : 'Copied the ydke:// link')
  } catch (e) {
    toast.error(errorMessage(e, 'Could not export the deck'))
  }
}
