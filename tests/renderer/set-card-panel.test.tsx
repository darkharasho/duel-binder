import { screen } from '@testing-library/react'
import { SetCardPanel } from '@/features/sets/SetCardPanel'
import { createMockApi, renderWithProviders } from './mockApi'
import { metalRaidersChecklist } from './setFixtures'

const alpha = metalRaidersChecklist.cards[0]

function renderPanel(rarity: string | null): void {
  renderWithProviders(
    <SetCardPanel
      setName="Metal Raiders"
      card={alpha}
      rarity={rarity}
      busy={false}
      onAdjust={() => {}}
      onMoreOptions={() => {}}
      onClose={() => {}}
    />,
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
