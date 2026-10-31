import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CardDetail, CountMode, EntryView } from '@shared/types'
import { SetChecklist } from '@/features/sets/SetChecklist'
import { createMockApi, renderWithProviders } from './mockApi'
import { metalRaidersChecklist, PRINTING } from './setFixtures'

function renderChecklist(
  o: { mode?: CountMode; checklist?: typeof metalRaidersChecklist | null } = {}
): {
  forCard: ReturnType<typeof vi.fn>
  onAddMissing: ReturnType<typeof vi.fn>
  onBack: ReturnType<typeof vi.fn>
} {
  const forCard = vi.fn(async () => [])
  const onAddMissing = vi.fn()
  const onBack = vi.fn()
  const api = createMockApi({
    sets: {
      checklist: async () => (o.checklist === undefined ? metalRaidersChecklist : o.checklist)
    },
    collection: { forCard }
  })
  renderWithProviders(
    <SetChecklist
      setName="Metal Raiders"
      language="en"
      mode={o.mode ?? 'cards'}
      onModeChange={() => {}}
      onBack={onBack}
      onAddMissing={onAddMissing}
    />,
    { api }
  )
  return { forCard, onAddMissing, onBack }
}

describe('SetChecklist', () => {
  it("asks for an OCG set's unpriced printings to be priced", async () => {
    const request = vi.fn(async () => {})
    const api = createMockApi({
      sets: {
        checklist: async () => ({
          ...metalRaidersChecklist,
          set: { ...metalRaidersChecklist.set, language: 'ja' as const }
        })
      },
      prices: { request }
    })
    renderWithProviders(
      <SetChecklist
        setName="Metal Raiders"
        language="ja"
        mode="cards"
        onModeChange={() => {}}
        onBack={() => {}}
        onAddMissing={() => {}}
      />,
      { api }
    )
    // Only Beta Knight's Common has no price.
    await waitFor(() => expect(request).toHaveBeenCalledWith([PRINTING.beta]), { timeout: 3000 })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('shows the language tag and the unmatched-rows note', async () => {
    renderChecklist({
      checklist: {
        ...metalRaidersChecklist,
        set: { ...metalRaidersChecklist.set, language: 'ja', listRows: 61, unmatchedRows: 1 }
      }
    })
    expect(
      await screen.findByText("60 of 61 cards listed; 1 couldn't be identified")
    ).toBeInTheDocument()
    expect(screen.getByText('JP')).toBeInTheDocument()
  })

  it('lists cards in set order with number labels and owned state', async () => {
    renderChecklist()
    const tiles = await screen.findAllByRole('button', {
      name: /Alpha Dragon|Beta Knight|Gamma Trap/
    })
    expect(tiles.map((t) => t.textContent)).toEqual([
      expect.stringContaining('Alpha Dragon'),
      expect.stringContaining('Beta Knight'),
      expect.stringContaining('Gamma Trap')
    ])
    expect(within(tiles[0]).getByText('001')).toBeInTheDocument()
    expect(within(tiles[1]).getByText('002')).toBeInTheDocument()
    expect(within(tiles[2]).getByText('010')).toBeInTheDocument()
    expect(tiles[0]).toHaveAttribute('data-owned', 'true')
    expect(within(tiles[0]).getByText('×2')).toBeInTheDocument()
    expect(tiles[1]).toHaveAttribute('data-owned', 'false')
    expect(tiles[1]).toHaveClass('grayscale', 'opacity-40')
  })

  it('Missing filter hides owned cards', async () => {
    renderChecklist()
    await screen.findByRole('button', { name: /Alpha Dragon/ })
    await userEvent.click(screen.getByRole('radio', { name: 'Missing' }))
    expect(screen.queryByRole('button', { name: /Alpha Dragon/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Beta Knight/ })).toBeInTheDocument()
  })

  it('rarities mode shows one tile per rarity', async () => {
    renderChecklist({ mode: 'rarities' })
    const ultra = await screen.findByRole('button', { name: /Alpha Dragon.*Ultra Rare/ })
    const secret = screen.getByRole('button', { name: /Alpha Dragon.*Secret Rare/ })
    expect(ultra).toHaveAttribute('data-owned', 'true')
    expect(secret).toHaveAttribute('data-owned', 'false')
  })

  it('clicking an owned tile opens the detail panel', async () => {
    const { forCard } = renderChecklist()
    await userEvent.click(await screen.findByRole('button', { name: /Alpha Dragon/ }))
    expect(forCard).toHaveBeenCalledWith(1001)
  })

  it('clicking a missing tile opens a panel with steppers for that set', async () => {
    const adjust = vi.fn(async () => ({
      ...metalRaidersChecklist.cards[2],
      owned: 1,
      rarities: metalRaidersChecklist.cards[2].rarities.map((r) => ({ ...r, owned: 1 }))
    }))
    const onAddMissing = vi.fn()
    const api = createMockApi({
      sets: { checklist: async () => metalRaidersChecklist, adjust },
      // The server's copies once the add went through.
      collection: {
        forCard: vi.fn(async () =>
          adjust.mock.calls.length > 0
            ? ([
                {
                  id: 9,
                  quantity: 1,
                  imageId: 3001,
                  unitPrice: 3,
                  printing: { id: PRINTING.gammaEN010 },
                  card: { name: 'Gamma Trap' }
                }
              ] as EntryView[])
            : []
        )
      },
      cards: {
        get: async () =>
          ({
            card: { id: 3001, name: 'Gamma Trap', type: 'Trap Card' },
            printings: [
              {
                id: PRINTING.gammaEN010,
                cardId: 3001,
                setName: 'Metal Raiders',
                setCode: 'MRD-EN010',
                setRarity: 'Common',
                setRarityCode: '',
                setPrice: 3,
                missingFromApi: false,
                language: 'en'
              }
            ],
            images: [{ imageId: 3001, cardId: 3001, sortOrder: 0 }]
          }) as CardDetail
      }
    })
    renderWithProviders(
      <SetChecklist
        setName="Metal Raiders"
        language="en"
        mode="cards"
        onModeChange={() => {}}
        onBack={() => {}}
        onAddMissing={onAddMissing}
      />,
      { api }
    )
    await userEvent.click(await screen.findByRole('button', { name: /Gamma Trap/ }))
    const panel = await screen.findByRole('dialog')
    expect(await within(panel).findByText('You have none yet')).toBeInTheDocument()
    expect(onAddMissing).not.toHaveBeenCalled()
    // The viewed rarity's price, named, and again on its stepper row.
    expect(within(panel).getByText(/^Market price · /)).toBeInTheDocument()
    expect(await within(panel).findAllByText('$3.00')).toHaveLength(2)

    await userEvent.click(
      within(panel).getByRole('button', { name: 'Add one Gamma Trap MRD-EN010 Common' })
    )
    expect(adjust).toHaveBeenCalledWith('Metal Raiders', 'en', PRINTING.gammaEN010, 1)
    expect(await within(panel).findByText('You have 1')).toBeInTheDocument()

    await userEvent.click(within(panel).getByRole('button', { name: 'More options…' }))
    expect(onAddMissing).toHaveBeenCalledWith(
      {
        id: 3001,
        name: 'Gamma Trap',
        type: 'Trap Card',
        defaultImageId: 3001,
        matchedSetCode: null
      },
      PRINTING.gammaEN010
    )
  })

  it('arrows step through the visible tiles, opening each as a click would', async () => {
    const { forCard } = renderChecklist()
    await userEvent.click(await screen.findByRole('button', { name: /Beta Knight/ }))
    const panel = await screen.findByRole('dialog')
    expect(within(panel).getByRole('heading', { name: 'Beta Knight' })).toBeInTheDocument()

    await userEvent.click(screen.getAllByRole('button', { name: 'Next card' })[0])
    expect(within(panel).getByRole('heading', { name: 'Gamma Trap' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Next card' })[0]).toBeDisabled()

    await userEvent.click(screen.getAllByRole('button', { name: 'Previous card' })[0])
    await userEvent.click(screen.getAllByRole('button', { name: 'Previous card' })[0])
    await waitFor(() => expect(forCard).toHaveBeenCalledWith(1001))
    expect(screen.getByRole('dialog')).toBe(panel)
  })

  it('All sets goes back', async () => {
    const { onBack } = renderChecklist()
    await screen.findByRole('button', { name: /Alpha Dragon/ })
    await userEvent.click(await screen.findByRole('button', { name: /All sets/ }))
    expect(onBack).toHaveBeenCalled()
  })

  it('shows a message when the set vanished', async () => {
    const { onBack } = renderChecklist({ checklist: null })
    expect(await screen.findByText('This set is no longer in the card data')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /All sets/ }))
    expect(onBack).toHaveBeenCalled()
  })

  it('search narrows the set by name or code, and says when nothing matches', async () => {
    renderChecklist()
    await screen.findByRole('button', { name: 'Alpha Dragon' })
    await userEvent.type(screen.getByLabelText('Search this set'), 'beta')
    expect(screen.queryByRole('button', { name: 'Alpha Dragon' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Beta Knight' })).toBeInTheDocument()
    await userEvent.clear(screen.getByLabelText('Search this set'))
    await userEvent.type(screen.getByLabelText('Search this set'), 'mrd-e001')
    expect(screen.getByRole('button', { name: 'Alpha Dragon' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Beta Knight' })).not.toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Search this set'), 'zzz')
    expect(screen.getByText(/No cards in this set match/)).toBeInTheDocument()
  })

  it('tiles ask for the printing scan of their rarity', async () => {
    renderChecklist()
    const tile = await screen.findByRole('button', { name: 'Alpha Dragon' })
    expect(within(tile).getByTestId('printing-scan')).toHaveAttribute(
      'src',
      expect.stringMatching(/^ygo-img:\/\/printing\/\d+$/)
    )
  })
})
