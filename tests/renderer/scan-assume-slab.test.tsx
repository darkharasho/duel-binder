import { fireEvent, screen } from '@testing-library/react'
import { ScanHubProvider, useScanHub } from '@/features/scan/ScanHub'
import { AssumeSlabToggle } from '@/features/scan/AssumeSlabToggle'
import type { ScanDraft } from '@shared/scan/types'
import { GameProvider } from '@/lib/game'
import { createMockApi, renderWithProviders } from './mockApi'
import { printing } from './scanFakes'

const P = printing({ cardId: 7, name: 'Dark Magician', setCode: 'LOB-005', imageIds: [46986414] })
const draft = (): ScanDraft => ({
  game: undefined,
  cardId: 7,
  name: 'Dark Magician',
  imageId: 46986414,
  printingId: P.printingId,
  setCode: 'LOB-005',
  rarity: P.rarity,
  options: [P],
  flag: null,
  via: 'art'
})

function Rows(): React.JSX.Element {
  const { count, session } = useScanHub()
  return (
    <>
      <button onClick={() => count(draft())}>count</button>
      <ul>
        {session.rows.map((r) => (
          <li key={r.key} data-testid="row">
            {r.slab ? 'slab' : 'raw'}
          </li>
        ))}
      </ul>
    </>
  )
}

const renderHub = () =>
  renderWithProviders(
    <GameProvider>
      <ScanHubProvider>
        <AssumeSlabToggle />
        <Rows />
      </ScanHubProvider>
    </GameProvider>,
    { api: createMockApi() }
  )

describe('All slabs', () => {
  it('counts every card as a slab while on, and as scanned once off', async () => {
    renderHub()
    const toggle = await screen.findByRole('button', { name: 'All slabs' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(screen.getByText('count'))
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByText('count'))
    fireEvent.click(toggle)
    fireEvent.click(screen.getByText('count'))
    // Newest first.
    expect(screen.getAllByTestId('row').map((r) => r.textContent)).toEqual(['raw', 'slab', 'raw'])
  })

  it('is never saved', async () => {
    renderHub()
    fireEvent.click(await screen.findByRole('button', { name: 'All slabs' }))
    expect(JSON.stringify({ ...localStorage })).not.toMatch(/assumeSlab/)
  })
})
