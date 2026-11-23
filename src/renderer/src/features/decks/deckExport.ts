import { toast } from 'sonner'
import { encodeOplayV2, oplayLink } from '@shared/decks/onepiece/oplay'
import { toOpText } from '@shared/decks/onepiece/text'
import { toPtcgl } from '@shared/decks/pokemon/ptcgl'
import { toYdk, toYdke, toYgoText } from '@shared/decks/ygo/lists'
import type { DeckCard, DeckEntry } from '@shared/decks/types'
import type { GameId } from '@shared/games'
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

export type ExportKind = 'text' | 'link' | 'ydk' | 'oplay' | 'oplayLink'

/**
 * The deck's OPlay code, from the Leader's and the Deck's card numbers; `left` counts the entries
 * without one (left out).
 */
export function oplayCodeOf(
  cards: DeckEntry[],
  facts: Record<number, DeckCard>
): { code: string; left: number } {
  let leader: string | null = null
  const qty = new Map<string, number>()
  let left = 0
  for (const e of cards) {
    const number = facts[e.card]?.opNumber
    if (!number) left++
    else if (e.section === 'leader') leader ??= number
    else qty.set(number, (qty.get(number) ?? 0) + e.qty)
  }
  const entries = [...qty].map(([code, n]) => ({ code, qty: n }))
  return { code: encodeOplayV2({ leader, entries }), left }
}

/** Runs one export of the deck and says how it went. */
export async function exportDeck(
  kind: ExportKind,
  name: string,
  cards: DeckEntry[],
  facts: Record<number, DeckCard>,
  game: GameId = 'ygo'
): Promise<void> {
  try {
    if (game === 'op') {
      if (kind === 'oplay' || kind === 'oplayLink') {
        const { code, left } = oplayCodeOf(cards, facts)
        await copyText(kind === 'oplay' ? code : oplayLink(code))
        const what = kind === 'oplay' ? 'Copied the OPlay deck code' : 'Copied the OPlay link'
        toast.success(
          left > 0
            ? `${what}. ${left} ${left === 1 ? 'card' : 'cards'} without a card number ${left === 1 ? 'was' : 'were'} left out.`
            : what
        )
        return
      }
      await copyText(toOpText(cards, facts))
      toast.success('Copied the deck list')
      return
    }
    if (game === 'pkm') {
      await copyText(toPtcgl(cards, facts))
      toast.success('Copied the deck list')
      return
    }
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
