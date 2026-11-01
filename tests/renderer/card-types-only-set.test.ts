import { describe, expect, it } from 'vitest'
import { cardTypeRows } from '@/features/card/cardTypes'
import type { EntryView, Printing } from '@shared/types'

const printing = (id: number, setName: string, language = 'en'): Printing =>
  ({ id, setName, language, setCode: `C-${id}`, setRarity: 'Rare' }) as Printing
const here = { setName: 'Here', language: 'en' as const }
const rows = (printings: Printing[], copies: EntryView[] = [], onlySet = true): number[] =>
  cardTypeRows({ printings, copies, ownedAtOpen: new Set(), preferSet: here, onlySet }).map(
    (r) => r.printing.id
  )

describe('cardTypeRows onlySet', () => {
  const printings = [printing(1, 'Here'), printing(2, 'Elsewhere'), printing(3, 'Here', 'ja')]

  it("lists only the open set's printings in its language", () => {
    expect(rows(printings)).toEqual([1])
  })

  it('leaves out a copy owned in another set', () => {
    const copy = { id: 9, printing: printing(4, 'Elsewhere'), imageId: 1 } as EntryView
    expect(rows(printings, [copy])).toEqual([1])
  })

  it('lists everything when the card has no printing in the set', () => {
    expect(rows([printing(2, 'Elsewhere')])).toEqual([2])
  })

  it('without it, lists every printing', () => {
    expect(rows(printings, [], false)).toHaveLength(3)
  })
})
