import { describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { GameId } from '@shared/games'
import type { CardDetail, ChecklistCard, EntryView, Printing } from '@shared/types'
import { CardSheet } from '@/components/CardSheet'
import { CardPanel } from '@/features/card/CardPanel'
import { cardTypeRows } from '@/features/card/cardTypes'
import { queryKeys } from '@/lib/api'
import { GameProvider } from '@/lib/game'
import { createMockApi, renderWithProviders } from './mockApi'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }))

const printing = (id: number, extra: Partial<Printing> = {}): Printing => ({
  id,
  cardId: 1,
  setName: 'Legend of Blue Eyes',
  setCode: `LOB-00${id}`,
  setRarity: 'Ultra Rare',
  setRarityCode: '(UR)',
  language: 'en',
  setPrice: id,
  missingFromApi: false,
  ...extra
})

const card = { id: 1, name: 'Dark Magician', type: 'Normal Monster' } as CardDetail['card']

const entry = (id: number, p: Printing, extra: Partial<EntryView> = {}): EntryView =>
  ({
    id,
    quantity: 2,
    notes: '',
    createdAt: '',
    updatedAt: '',
    card,
    printing: p,
    imageId: 100,
    printingScan: true,
    unitPrice: p.setPrice,
    priceApproximate: false,
    priceSource: 'ygoprodeck',
    priceCheckedAt: null,
    priceListingCount: null,
    noPriceReason: null,
    totalValue: 0,
    ...extra
  }) as EntryView

const a = printing(1)
const b = printing(2, { setRarity: 'Secret Rare' })
const c = printing(3, { language: 'ja', setCode: 'DP-JP003' })
const unpricedJa = [a, b, printing(3, { setPrice: null, language: 'ja' })]
const seed = {
  name: 'Dark Magician',
  type: 'Normal Monster',
  imageId: 100,
  price: 1,
  defaultPrintingId: 1
}

function setup(
  copies: EntryView[],
  props: Partial<React.ComponentProps<typeof CardPanel>> = {},
  printings = [a, b, c],
  game: GameId = 'ygo',
  collection: { remove?: (id: number) => Promise<void> } = {}
): { adjust: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; qc: QueryClient } {
  const adjust = vi.fn(async () => ({ rarities: [] }) as unknown as ChecklistCard)
  const update = vi.fn(async (id: number) => copies.find((e) => e.id === id)!)
  const { client: qc } = renderWithProviders(
    <GameProvider>
      <CardSheet onClose={() => {}}>
        <CardPanel cardId={1} onClose={() => {}} {...props} />
      </CardSheet>
    </GameProvider>,
    {
      api: createMockApi({
        cards: {
          get: async () =>
            ({ card, printings, images: [{ imageId: 100, cardId: 1, sortOrder: 0 }] }) as CardDetail
        },
        collection: { forCard: async () => copies, update, ...collection },
        sets: { adjust },
        games: { available: async () => [game], active: async () => game }
      })
    }
  )
  return { adjust, update, qc }
}

const list = async (): Promise<HTMLElement> => {
  const section = await screen.findByRole('region', { name: 'Printings' })
  await within(section).findByRole('group', { name: /LOB-002/ })
  return section
}
const rowNames = (section: HTMLElement): (string | null)[] =>
  within(section)
    .getAllByRole('group')
    .map((r) => r.getAttribute('aria-label'))

describe('one card panel, owned or not', () => {
  it('lists the same types, with quantities on the owned ones', async () => {
    setup([], { seed })
    const unowned = rowNames(await list())
    cleanup()
    setup([entry(5, a)], { entryId: 5 })
    const section = await list()
    expect(rowNames(section)).toEqual(unowned)
    expect(
      within(section)
        .getByRole('group', { name: /LOB-001/ })
        .querySelector('[aria-busy]')
    ).toHaveTextContent('2')
    expect(within(section).getByText('You have 2')).toBeInTheDocument()
  })

  it('highlights the entry it opened on, and a click moves it and the price', async () => {
    setup([entry(5, a)], { entryId: 5 })
    const section = await list()
    const owned = within(section).getByRole('group', { name: /LOB-001/ })
    const other = within(section).getByRole('group', { name: /LOB-002/ })
    expect(owned).toHaveAttribute('aria-current', 'true')
    await userEvent.click(other)
    expect(other).toHaveAttribute('aria-current', 'true')
    expect(owned).not.toHaveAttribute('aria-current')
    expect(screen.getByText(/^Market price/).parentElement).toHaveTextContent(
      'Market price · Secret Rare $2.00'
    )
    // Not owned: nothing to edit there.
    expect(screen.queryByLabelText('Quantity')).not.toBeInTheDocument()
  })

  it('selecting rows changes no entry, and edits go to the selected row', async () => {
    const onSelectEntry = vi.fn()
    const { update, adjust } = setup([entry(5, a), entry(6, b, { quantity: 4 })], {
      entryId: 5,
      onSelectEntry
    })
    const section = await list()
    await userEvent.click(within(section).getByRole('group', { name: /LOB-002/ }))
    expect(onSelectEntry).toHaveBeenCalledWith(6)
    expect(update).not.toHaveBeenCalled()
    expect(adjust).not.toHaveBeenCalled()
    const qty = await screen.findByLabelText('Quantity')
    expect(qty).toHaveValue(4)
    await userEvent.clear(qty)
    await userEvent.type(qty, '5')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(update).toHaveBeenCalledWith(6, { quantity: 5 }))
  })

  it('adds a type in one click, through sets.adjust', async () => {
    const { adjust } = setup([entry(5, a)], { entryId: 5 })
    const section = await list()
    await userEvent.click(
      within(section).getByRole('button', { name: 'Add one Dark Magician DP-JP003 Ultra Rare' })
    )
    expect(adjust).toHaveBeenCalledWith('Legend of Blue Eyes', 'ja', 3, 1)
  })

  it('gives each entry of a printing its own row, whose −/+ edits that entry', async () => {
    const { adjust, update } = setup([entry(5, a), entry(6, a, { imageId: 101, quantity: 3 })], {
      entryId: 6
    })
    const section = await list()
    const rows = within(section).getAllByRole('group', { name: /LOB-001/ })
    expect(rows).toHaveLength(2)
    expect(rows[1]).toHaveAttribute('aria-current', 'true')
    expect(rows[0].querySelector('[aria-busy]')).toHaveTextContent('2')
    expect(rows[1].querySelector('[aria-busy]')).toHaveTextContent('3')
    expect(await screen.findByLabelText('Quantity')).toHaveValue(3)
    await userEvent.click(within(rows[1]).getByRole('button', { name: /^Add one/ }))
    await waitFor(() => expect(update).toHaveBeenCalledWith(6, { quantity: 4 }))
    await userEvent.click(within(rows[0]).getByRole('button', { name: /^Remove one/ }))
    await waitFor(() => expect(update).toHaveBeenCalledWith(5, { quantity: 1 }))
    expect(adjust).not.toHaveBeenCalled()
  })

  it('steps an entry on other art by its own id, and queued clicks add up', async () => {
    const { adjust, update } = setup([entry(6, a, { imageId: 101, quantity: 2 })], { entryId: 6 })
    const row = within(await list()).getByRole('group', { name: /LOB-001/ })
    const add = within(row).getByRole('button', { name: /^Add one/ })
    await userEvent.click(add)
    await userEvent.click(add)
    await waitFor(() => expect(update).toHaveBeenLastCalledWith(6, { quantity: 4 }))
    expect(adjust).not.toHaveBeenCalled()
  })

  it('asks before the − takes the last copy of an entry with notes', async () => {
    const { adjust } = setup([entry(5, a, { quantity: 1, notes: 'signed' })], { entryId: 5 })
    const row = within(await list()).getByRole('group', { name: /LOB-001/ })
    await userEvent.click(within(row).getByRole('button', { name: /^Remove one/ }))
    expect(adjust).not.toHaveBeenCalled()
    expect(screen.getByText('Remove this entry and its notes?')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(adjust).not.toHaveBeenCalled()
    await userEvent.click(within(row).getByRole('button', { name: /^Remove one/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(adjust).toHaveBeenCalledWith('Legend of Blue Eyes', 'en', 1, -1))
  })

  it('asks before the − takes the last copy without notes, as Remove does', async () => {
    const { adjust } = setup([entry(5, a, { quantity: 1 })], { entryId: 5 })
    const row = within(await list()).getByRole('group', { name: /LOB-001/ })
    await userEvent.click(within(row).getByRole('button', { name: /^Remove one/ }))
    expect(screen.getByText('Remove this entry?')).toBeInTheDocument()
    expect(adjust).not.toHaveBeenCalled()
  })

  it('takes a copy with no question while more remain', async () => {
    const { adjust } = setup([entry(5, a, { quantity: 2, notes: 'signed' })], { entryId: 5 })
    const row = within(await list()).getByRole('group', { name: /LOB-001/ })
    await userEvent.click(within(row).getByRole('button', { name: /^Remove one/ }))
    await waitFor(() => expect(adjust).toHaveBeenCalledWith('Legend of Blue Eyes', 'en', 1, -1))
  })

  it('removes the last copy of an entry on other art by its id, after asking', async () => {
    const remove = vi.fn(async () => undefined)
    setup([entry(6, a, { imageId: 101, quantity: 1 })], { entryId: 6 }, [a, b, c], 'ygo', {
      remove
    })
    const row = within(await list()).getByRole('group', { name: /LOB-001/ })
    await userEvent.click(within(row).getByRole('button', { name: /^Remove one/ }))
    expect(remove).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(remove).toHaveBeenCalledWith(6))
  })

  it('treats a printing the checklist leaves out as a success, not an error', async () => {
    const { adjust } = setup([entry(5, a)], { entryId: 5 })
    adjust.mockResolvedValue(undefined as unknown as ChecklistCard)
    const row = within(await list()).getByRole('group', { name: /LOB-001/ })
    await userEvent.click(within(row).getByRole('button', { name: /^Add one/ }))
    await waitFor(() => expect(adjust).toHaveBeenCalled())
    await waitFor(() => expect(row.querySelector('[aria-busy]')).toHaveTextContent('3'))
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled()
  })

  it('stays on the printing when its entry is removed from the row', async () => {
    const { qc } = setup([entry(5, a, { quantity: 1 })], { entryId: 5 })
    await list()
    expect(await screen.findByLabelText('Quantity')).toBeInTheDocument()
    qc.setQueryData(queryKeys.forCard(1), [])
    await waitFor(() => expect(screen.queryByLabelText('Quantity')).not.toBeInTheDocument())
    expect(within(await list()).getByRole('group', { name: /LOB-001/ })).toHaveAttribute(
      'aria-current',
      'true'
    )
  })

  it('keeps a notes draft when the row changes the quantity', async () => {
    const { qc } = setup([entry(5, a)], { entryId: 5 })
    await list()
    await userEvent.type(await screen.findByLabelText('Notes'), 'mint')
    qc.setQueryData(queryKeys.forCard(1), [entry(5, a, { quantity: 3, updatedAt: 'later' })])
    await waitFor(() => expect(screen.getByLabelText('Quantity')).toHaveValue(3))
    expect(screen.getByLabelText('Notes')).toHaveValue('mint')
  })

  it("hides the opened set's caption on a row of another set", async () => {
    const other = printing(2, { setName: 'Metal Raiders' })
    setup(
      [],
      {
        seed,
        caption: 'Legend of Blue Eyes · 001',
        preferSet: { setName: 'Legend of Blue Eyes', language: 'en' }
      },
      [a, other, c]
    )
    const section = await list()
    expect(screen.getByText('Legend of Blue Eyes · 001')).toBeInTheDocument()
    await userEvent.click(within(section).getByRole('group', { name: /LOB-002/ }))
    expect(screen.queryByText('Legend of Blue Eyes · 001')).not.toBeInTheDocument()
  })

  it('offers no retired printing unless a copy is on it', async () => {
    const retired = printing(4, { setCode: 'LOB-004', missingFromApi: true })
    setup([], { seed }, [a, b, retired])
    expect(rowNames(await list()).join()).not.toContain('LOB-004')
    cleanup()
    setup([entry(7, retired)], { entryId: 7 }, [a, b, retired])
    expect(rowNames(await list()).join()).toContain('LOB-004')
  })

  it('stands the card price in for a Yu-Gi-Oh! printing with none', async () => {
    setup([], { seed: { ...seed, price: 50, defaultPrintingId: 3 } }, unpricedJa)
    await list()
    expect(screen.getByText(/^Market price/).parentElement).toHaveTextContent(
      'cheapest printing $50.00'
    )
  })

  it('never stands it in for a Pokémon printing: no cross-language price', async () => {
    setup([], { seed: { ...seed, price: 50, defaultPrintingId: 3 } }, unpricedJa, 'pkm')
    await list()
    await screen.findByText('No price')
    expect(screen.queryByText('$50.00')).not.toBeInTheDocument()
  })
})

describe('CardPanel versions of one art', () => {
  const normal = printing(1, { setRarity: 'Normal' })
  const reverse = printing(2, { setRarity: 'Reverse Holofoil' })

  it('names the selected Pokémon version in the chip, and moves with the row', async () => {
    setup([], { printingId: 1 }, [normal, reverse], 'pkm')
    const chip = await screen.findByTestId('selected-version')
    await waitFor(() => expect(chip).toHaveTextContent('Normal'))
    await userEvent.click(await screen.findByText('Reverse Holofoil'))
    await waitFor(() =>
      expect(screen.getByTestId('selected-version')).toHaveTextContent('Reverse Holofoil')
    )
    cleanup()
  })

  it('leaves Yu-Gi-Oh! as it was', async () => {
    setup([], { printingId: 1 }, [a, b], 'ygo')
    await screen.findByText(/Market price · Ultra Rare/)
    expect(screen.queryByTestId('selected-version')).toBeNull()
    cleanup()
  })
})

describe('cardTypeRows', () => {
  const base = { originalImageId: 100, ownedAtOpen: new Set<number>() }

  it('lists the owned first, then the opened set, then English', () => {
    const inSet = printing(4, { setName: 'Other', language: 'ja', setCode: 'O-1' })
    const rows = cardTypeRows({
      ...base,
      printings: [c, a, inSet, b],
      copies: [entry(5, b)],
      ownedAtOpen: new Set([b.id]),
      preferSet: { setName: 'Other', language: 'ja' }
    })
    expect(rows.map((r) => r.printing.id)).toEqual([2, 4, 1, 3])
  })

  it("puts the opened tile's printing first of its set", () => {
    const rows = cardTypeRows({
      ...base,
      printings: [a, b],
      copies: [],
      preferSet: { setName: a.setName, language: 'en' },
      openedPrintingId: 2
    })
    expect(rows.map((r) => r.printing.id)).toEqual([2, 1])
  })

  it("lists an entry's contributed printing the card's list leaves out", () => {
    const rows = cardTypeRows({ ...base, printings: [a], copies: [entry(5, b)] })
    expect(rows.map((r) => r.printing.id)).toEqual([1, 2])
  })

  it('sends −/+ through sets.adjust only where it reaches the row: original art, one entry', () => {
    const rows = cardTypeRows({
      ...base,
      printings: [a, b, c],
      copies: [entry(5, a), entry(6, b, { imageId: 101 })]
    })
    expect(rows.map((r) => r.viaPrinting)).toEqual([true, false, true])
  })
})
