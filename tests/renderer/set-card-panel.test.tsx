import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CardSheet } from '@/components/CardSheet'
import { SetCardPanel } from '@/features/sets/SetCardPanel'
import { createMockApi, renderWithProviders } from './mockApi'
import { metalRaidersChecklist } from './setFixtures'

const alpha = metalRaidersChecklist.cards[0]

function renderPanel(rarity: string | null): void {
  renderWithProviders(
    <CardSheet onClose={() => {}}>
      <SetCardPanel
        setName="Metal Raiders"
        card={alpha}
        rarity={rarity}
        busy={false}
        onAdjust={() => {}}
        onMoreOptions={() => {}}
      />
    </CardSheet>,
    { api: createMockApi() }
  )
}

describe('SetCardPanel market price', () => {
  it('prices the rarity whose tile was opened, naming it', () => {
    renderPanel('Ultra Rare')
    expect(screen.getByText(/^Market price/).parentElement).toHaveTextContent(
      'Market price · Ultra Rare $12.00'
    )
  })

  it('a dearer rarity shows its own price', () => {
    renderPanel('Secret Rare')
    expect(screen.getByText(/^Market price/).parentElement).toHaveTextContent(
      'Market price · Secret Rare $40.00'
    )
  })
})

describe('SetCardPanel picked rarity', () => {
  const row = (rarity: string): HTMLElement =>
    screen.getByRole('group', { name: `${alpha.name} ${rarity}` })

  it('marks the opened rarity as current', () => {
    renderPanel('Ultra Rare')
    expect(row('Ultra Rare')).toHaveAttribute('aria-current', 'true')
    expect(row('Secret Rare')).not.toHaveAttribute('aria-current')
  })

  it('clicking a row moves the mark, the price and the focus ring target', async () => {
    renderPanel('Ultra Rare')
    await userEvent.click(row('Secret Rare'))
    expect(row('Secret Rare')).toHaveAttribute('aria-current', 'true')
    expect(row('Ultra Rare')).not.toHaveAttribute('aria-current')
    expect(screen.getByText(/^Market price/).parentElement).toHaveTextContent('Secret Rare $40.00')
  })

  it('is keyboard focusable and Enter picks', async () => {
    renderPanel('Ultra Rare')
    row('Secret Rare').focus()
    await userEvent.keyboard('{Enter}')
    expect(row('Secret Rare')).toHaveAttribute('aria-current', 'true')
  })

  it('pressing + keeps the row picked', async () => {
    renderPanel('Ultra Rare')
    await userEvent.click(screen.getByRole('button', { name: `Add one ${alpha.name} Secret Rare` }))
    expect(row('Secret Rare')).toHaveAttribute('aria-current', 'true')
  })
})
