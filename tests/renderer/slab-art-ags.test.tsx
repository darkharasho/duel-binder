import { render, screen } from '@testing-library/react'
import { SlabArt } from '@/features/graded/SlabArt'

vi.mock('@/components/CardArt', () => ({ CardArt: () => <img alt="" /> }))

const slab = (grade: string) =>
  ({
    game: 'pkm',
    imageId: 1,
    company: 'AGS',
    grade,
    label: '',
    cert: '00542120',
    subgrades: '',
    card: { name: 'Trevenant VMAX' },
    printing: { id: 1, setName: 'Blue Sky Stream', setCode: '008/067', setRarity: 'RRR' }
  }) as never

describe('the AGS slab', () => {
  it('draws AGS’s label: word over grade over cert, gold frame from 9.5', () => {
    const { container } = render(<SlabArt slab={slab('10')} />)
    expect(screen.getByTestId('slab')).toHaveAttribute('data-grader', 'AGS')
    expect(screen.getByText('GEM-MT')).toBeInTheDocument()
    expect(screen.getByText('00542120')).toBeInTheDocument()
    expect(screen.getAllByText('AGS').length).toBeGreaterThan(0)
    expect(container.querySelector('.slab-navy')).toBeNull()
  })

  it('frames a 9 in navy', () => {
    const { container } = render(<SlabArt slab={slab('9')} />)
    expect(screen.getByText('MINT')).toBeInTheDocument()
    expect(container.querySelector('.slab-ags.slab-navy')).not.toBeNull()
  })
})
