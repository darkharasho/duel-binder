import { render, screen } from '@testing-library/react'
import { ArtWash } from '@/components/ArtWash'

describe('ArtWash', () => {
  it('shows the game glow alone where there is no art', () => {
    render(<ArtWash src={null} />)
    expect(screen.getByTestId('art-glow')).toHaveAttribute('data-game', 'ygo')
    expect(screen.queryByTestId('art-wash')).not.toBeInTheDocument()
  })

  it('keeps the glow under the art, for art that is dark or still loading', () => {
    render(<ArtWash src="ygo-img://small/5" />)
    expect(screen.getByTestId('art-glow')).toBeInTheDocument()
    expect(screen.getByTestId('art-wash')).toBeInTheDocument()
  })

  it('draws nothing when glow is off and there is no art', () => {
    const { container } = render(<ArtWash src={null} glow={false} />)
    expect(container).toBeEmptyDOMElement()
  })
})
