import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mtgBackImageId, mtgCardId, mtgImageId } from '@shared/games'
import type { CardDetail, CardImage, Printing } from '@shared/types'
import { CardSheet } from '@/components/CardSheet'
import { CardPanel } from '@/features/card/CardPanel'
import { GameProvider } from '@/lib/game'
import { createMockApi, renderWithProviders } from './mockApi'

const delver = mtgCardId('en', 'delver-oracle')
const angel = mtgCardId('en', 'angel-oracle')
const front = mtgImageId('delver-1')
const back = mtgBackImageId('delver-1')
const plain = mtgImageId('delver-2')
const angelFront = mtgImageId('angel-1')
const angelBack = mtgBackImageId('angel-1')

const printing = (id: number, cardId: number, setCode: string, artImageId: number): Printing => ({
  id,
  cardId,
  setName: 'Innistrad',
  setCode,
  setRarity: 'Common',
  setRarityCode: '',
  language: 'en',
  setPrice: null,
  missingFromApi: false,
  artImageId
})
const image = (
  imageId: number,
  cardId: number,
  sortOrder: number,
  backImageId?: number
): CardImage => ({
  imageId,
  cardId,
  sortOrder,
  ...(backImageId !== undefined ? { backImageId } : {})
})

const details: Record<number, CardDetail> = {
  [delver]: {
    card: { id: delver, name: 'Delver of Secrets', type: 'Creature' } as CardDetail['card'],
    printings: [printing(1, delver, 'ISD 51', front), printing(2, delver, 'ISD 52', plain)],
    images: [image(front, delver, 0, back), image(plain, delver, 1)]
  },
  [angel]: {
    card: { id: angel, name: 'Archangel Avacyn', type: 'Creature' } as CardDetail['card'],
    printings: [printing(3, angel, 'SOI 5', angelFront)],
    images: [image(angelFront, angel, 0, angelBack)]
  }
}

function panel(cardId: number, printingId: number): React.JSX.Element {
  return (
    <GameProvider>
      <CardSheet onClose={() => {}}>
        <CardPanel cardId={cardId} printingId={printingId} onClose={() => {}} />
      </CardSheet>
    </GameProvider>
  )
}

function setup(cardId: number, printingId: number): ReturnType<typeof renderWithProviders> {
  return renderWithProviders(panel(cardId, printingId), {
    api: createMockApi({
      cards: { get: async (id: number) => details[id] },
      collection: { forCard: async () => [] },
      games: { available: async () => ['ygo', 'mtg'], active: async () => 'mtg' }
    })
  })
}

/** The card's art: the panel's own (named) image; the large floated copy has no alt. */
const art = (name: string): Promise<HTMLElement> => screen.findByAltText(name)
const shows = async (name: string, imageId: number): Promise<void> =>
  waitFor(async () => expect((await art(name)).getAttribute('src')).toContain(`full/${imageId}`))
const flipButtons = (label: string): HTMLElement[] => screen.getAllByRole('button', { name: label })

describe('CardPanel flips a two-faced Magic card', () => {
  it('swaps the art to the back face and back again', async () => {
    const user = userEvent.setup()
    setup(delver, 1)
    await shows('Delver of Secrets', front)
    await user.click(flipButtons('Show back face')[0])
    await shows('Delver of Secrets', back)
    expect(screen.queryAllByRole('button', { name: 'Show back face' })).toHaveLength(0)
    await user.click(flipButtons('Show front face')[0])
    await shows('Delver of Secrets', front)
  })

  it('shows the front again when another printing is selected', async () => {
    const user = userEvent.setup()
    setup(delver, 1)
    await shows('Delver of Secrets', front)
    await user.click(flipButtons('Show back face')[0])
    await shows('Delver of Secrets', back)
    const list = await screen.findByRole('region', { name: 'Printings' })
    await user.click(within(list).getByRole('button', { name: /^Delver of Secrets ISD 52/ }))
    await shows('Delver of Secrets', plain)
    // That art has no back: no flip control.
    expect(screen.queryByRole('button', { name: /Show (back|front) face/ })).toBeNull()
    await user.click(within(list).getByRole('button', { name: /^Delver of Secrets ISD 51/ }))
    await shows('Delver of Secrets', front)
    expect(flipButtons('Show back face').length).toBeGreaterThan(0)
  })

  it('shows the front of another card the panel moves to', async () => {
    const user = userEvent.setup()
    const { rerender } = setup(delver, 1)
    await shows('Delver of Secrets', front)
    await user.click(flipButtons('Show back face')[0])
    await shows('Delver of Secrets', back)
    rerender(panel(angel, 3))
    await shows('Archangel Avacyn', angelFront)
    expect(flipButtons('Show back face').length).toBeGreaterThan(0)
  })

  it('has no flip control on art without a back', async () => {
    setup(delver, 2)
    await shows('Delver of Secrets', plain)
    expect(screen.queryByRole('button', { name: /Show (back|front) face/ })).toBeNull()
  })
})
