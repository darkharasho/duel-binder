import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlaceholderRequest } from '@shared/placeholders'
import type { BinderCard, BinderDetail, CardRow, Printing } from '@shared/types'
import { BinderPlaceholdersButton } from '@/features/binders/BinderPlaceholders'
import { binderPlaceholders } from '@/features/binders/placeholderCards'
import {
  binderSorts,
  readBinderOrder,
  saveBinderOrder,
  sortBinderCards
} from '@/features/binders/binderSort'
import { createMockApi, renderWithProviders } from './mockApi'

const slot = (
  name: string,
  over: Omit<Partial<BinderCard>, 'card'> & { card?: Partial<CardRow> } = {}
): BinderCard => {
  const { card, ...rest } = over
  return {
    key: `card:${name}`,
    level: 'card',
    card: { id: 1, name, type: 'Normal Monster', frameType: 'normal', ...card } as CardRow,
    imageId: 7,
    printing: null,
    printingScan: true,
    releaseDate: null,
    owned: 0,
    added: false,
    price: null,
    ...rest
  }
}
const printing = (setCode: string, over: Partial<Printing> = {}): Printing => ({
  id: 1,
  cardId: 1,
  setName: 'Legend of Blue Eyes White Dragon',
  setCode,
  setRarity: 'Ultra Rare',
  setRarityCode: '(UR)',
  setPrice: null,
  missingFromApi: false,
  language: 'en',
  ...over
})
const names = (cards: BinderCard[]): string[] => cards.map((c) => c.card.name)

describe('sortBinderCards', () => {
  const a = slot('Alpha', { releaseDate: '2004-01-01', price: 1 })
  const b = slot('Bravo', { releaseDate: '2002-03-08', price: 5 })
  const c = slot('Charlie', { releaseDate: null, price: null })

  it('orders by release date either way, undated last', () => {
    expect(names(sortBinderCards([a, c, b], { by: 'release', dir: 'asc' }, 'ygo'))).toEqual([
      'Bravo',
      'Alpha',
      'Charlie'
    ])
    expect(names(sortBinderCards([a, c, b], { by: 'release', dir: 'desc' }, 'ygo'))).toEqual([
      'Alpha',
      'Bravo',
      'Charlie'
    ])
  })

  it('orders by price, unpriced last', () => {
    expect(names(sortBinderCards([a, c, b], { by: 'price', dir: 'desc' }, 'ygo'))).toEqual([
      'Bravo',
      'Alpha',
      'Charlie'
    ])
  })

  it('orders Yu-Gi-Oh! by frame, then by release within a frame', () => {
    const trap = slot('Trap', { card: { frameType: 'trap' }, releaseDate: '2001-01-01' })
    const xyz = slot('Xyz', { card: { frameType: 'xyz' } })
    const late = slot('Late', { releaseDate: '2010-01-01' })
    const early = slot('Early', { releaseDate: '2003-01-01' })
    expect(
      names(sortBinderCards([trap, xyz, late, early], { by: 'type', dir: 'asc' }, 'ygo'))
    ).toEqual(['Early', 'Late', 'Xyz', 'Trap'])
  })

  it('orders Pokémon by energy type, then Trainers and Energy', () => {
    const mon = (name: string, types: string[]): BinderCard =>
      slot(name, { card: { type: 'Pokemon', pokemon: { types } as CardRow['pokemon'] } })
    const trainer = slot('Professor', { card: { type: 'Trainer' } })
    const sorted = sortBinderCards(
      [
        trainer,
        mon('Squirtle', ['Water']),
        mon('Charmander', ['Fire']),
        mon('Bulbasaur', ['Grass'])
      ],
      { by: 'type', dir: 'asc' },
      'pkm'
    )
    expect(names(sorted)).toEqual(['Bulbasaur', 'Charmander', 'Squirtle', 'Professor'])
  })

  it('orders set numbers naturally', () => {
    const at = (code: string): BinderCard => slot(code, { printing: printing(code) })
    const sorted = sortBinderCards(
      [at('LOB-EN010'), at('LOB-EN002'), at('LOB-EN100')],
      { by: 'number', dir: 'asc' },
      'ygo'
    )
    expect(names(sorted)).toEqual(['LOB-EN002', 'LOB-EN010', 'LOB-EN100'])
  })
})

describe('binder order choices', () => {
  beforeEach(() => localStorage.clear())

  it('offers set number only for a printing binder', () => {
    expect(binderSorts('printing').some((o) => o.value === 'number')).toBe(true)
    expect(binderSorts('card').some((o) => o.value === 'number')).toBe(false)
  })

  it('remembers each binder its own order, oldest first by default', () => {
    expect(readBinderOrder('b1', 'card')).toEqual({ by: 'release', dir: 'asc' })
    saveBinderOrder('b1', { by: 'name', dir: 'desc' })
    expect(readBinderOrder('b1', 'card')).toEqual({ by: 'name', dir: 'desc' })
    expect(readBinderOrder('b2', 'card')).toEqual({ by: 'release', dir: 'asc' })
  })

  it("drops a saved order the binder's goal no longer offers", () => {
    saveBinderOrder('b1', { by: 'number', dir: 'asc' })
    expect(readBinderOrder('b1', 'card')).toEqual({ by: 'release', dir: 'asc' })
  })
})

describe('binderPlaceholders', () => {
  it("names a printing slot's set, number and rarity; a card slot's binder", () => {
    const yugi = slot('Dark Magician', { printing: printing('LOB-EN005') })
    const any = slot('Pot of Greed', { imageId: 0 })
    expect(binderPlaceholders([yugi, any], 'ygo')).toEqual([
      {
        imageId: 7,
        name: 'Dark Magician',
        number: 'LOB-EN005',
        rarity: 'Ultra Rare',
        finish: null,
        setName: 'Legend of Blue Eyes White Dragon',
        setCode: 'LOB'
      },
      {
        imageId: 0,
        name: 'Pot of Greed',
        number: '',
        rarity: null,
        finish: null,
        setName: null,
        setCode: null
      }
    ])
  })

  it("gives a Pokémon printing its card's rarity and the printing's finish", () => {
    const pikachu = slot('Pikachu', {
      card: { pokemon: { rarity: 'Common' } as CardRow['pokemon'] },
      printing: printing('DRI 012/182', {
        setName: 'Destined Rivals',
        setRarity: 'Reverse Holofoil'
      })
    })
    expect(binderPlaceholders([pikachu], 'pkm')[0]).toMatchObject({
      number: 'DRI 012/182',
      rarity: 'Common',
      finish: 'Reverse Holofoil',
      setCode: 'DRI'
    })
  })
})

describe('BinderPlaceholdersButton', () => {
  const detail = { uid: 'b1', name: 'Blue-Eyes', goal: 'card' } as BinderDetail

  it('prints the missing slots in the order given', async () => {
    const save = vi.fn(async (_request: PlaceholderRequest) => '/tmp/x.pdf' as string | null)
    renderWithProviders(
      <BinderPlaceholdersButton
        detail={detail}
        cards={[slot('Zeta'), slot('Owned', { owned: 1 }), slot('Alpha')]}
      />,
      { api: createMockApi({ placeholders: { save } }) }
    )
    await userEvent.click(screen.getByRole('button', { name: 'Placeholders' }))
    expect(screen.getByText('2 cards on 1 sheet.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Save PDF' }))
    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(save.mock.calls[0]?.[0]).toMatchObject({ setName: 'Blue-Eyes', style: 'soft' })
    expect(save.mock.calls[0]?.[0].cards.map((c) => c.name)).toEqual(['Zeta', 'Alpha'])
  })
})
