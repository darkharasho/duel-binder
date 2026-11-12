import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CardDetail, Printing } from '@shared/types'
import { CardSheet } from '@/components/CardSheet'
import { CardPanel } from '@/features/card/CardPanel'
import { createMockApi, renderWithProviders } from './mockApi'
import { metalRaidersChecklist, PRINTING } from './setFixtures'

const alpha = metalRaidersChecklist.cards[0]

const printing = (id: number, setCode: string, setRarity: string, setPrice: number): Printing => ({
  id,
  cardId: alpha.cardId,
  setName: 'Metal Raiders',
  setCode,
  setRarity,
  setRarityCode: '',
  setPrice,
  missingFromApi: false,
  language: 'en'
})

const secret = printing(PRINTING.alphaSecret, 'MRD-001', 'Secret Rare', 40)
const ultra = printing(PRINTING.alphaUltraE001, 'MRD-E001', 'Ultra Rare', 12)
const adjust = vi.fn(async () => alpha)

function renderPanel(printingId: number): void {
  renderWithProviders(
    <CardSheet onClose={() => {}}>
      <CardPanel
        cardId={alpha.cardId}
        seed={{ ...alpha, defaultPrintingId: printingId }}
        caption="Metal Raiders · 001"
        preferSet={{ setName: 'Metal Raiders', language: 'en' }}
        onClose={() => {}}
      />
    </CardSheet>,
    {
      api: createMockApi({
        cards: {
          get: async () =>
            ({
              card: { id: alpha.cardId, name: alpha.name, type: alpha.type },
              printings: [secret, ultra],
              images: [{ imageId: alpha.imageId, cardId: alpha.cardId, sortOrder: 0 }]
            }) as CardDetail
        },
        sets: { adjust }
      })
    }
  )
}

/** A printing's pill in the full list, named for the printing as its row was. */
const row = (p: Printing): Promise<HTMLElement> =>
  screen.findByRole('button', { name: `${alpha.name} ${p.setCode} ${p.setRarity}` })

describe('card panel opened from a set', () => {
  it('prices the rarity whose tile was opened, naming it', async () => {
    renderPanel(ultra.id)
    await row(ultra)
    expect(screen.getByText(/^Market price/).parentElement).toHaveTextContent(
      'Market price · Ultra Rare $12.00'
    )
  })

  it('shows the set and number', async () => {
    renderPanel(ultra.id)
    expect(await screen.findByText('Metal Raiders · 001')).toBeInTheDocument()
  })

  it('marks the opened printing as current', async () => {
    renderPanel(ultra.id)
    expect(await row(ultra)).toHaveAttribute('aria-pressed', 'true')
    expect(await row(secret)).toHaveAttribute('aria-pressed', 'false')
  })

  it('clicking a row moves the mark and the price', async () => {
    renderPanel(ultra.id)
    await userEvent.click(await row(secret))
    expect(await row(secret)).toHaveAttribute('aria-pressed', 'true')
    expect(await row(ultra)).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText(/^Market price/).parentElement).toHaveTextContent('Secret Rare $40.00')
  })

  it('is keyboard focusable and Enter picks', async () => {
    renderPanel(ultra.id)
    ;(await row(secret)).focus()
    await userEvent.keyboard('{Enter}')
    expect(await row(secret)).toHaveAttribute('aria-pressed', 'true')
  })

  it('pressing + keeps the row picked and adds through sets.adjust', async () => {
    renderPanel(ultra.id)
    await userEvent.click(await row(secret))
    await userEvent.click(
      await screen.findByRole('button', { name: `Add one ${alpha.name} MRD-001 Secret Rare` })
    )
    expect(await row(secret)).toHaveAttribute('aria-pressed', 'true')
    expect(adjust).toHaveBeenCalledWith('Metal Raiders', 'en', secret.id, 1)
  })
})
