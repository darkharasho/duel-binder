import { fireEvent, render, screen } from '@testing-library/react'
import { CardArt } from '@/components/CardArt'

describe('CardArt', () => {
  it('without a printing it is the plain default art', () => {
    render(<CardArt imageId={5} size="small" alt="Kuriboh" />)
    expect(screen.getByAltText('Kuriboh')).toHaveAttribute('src', 'ygo-img://small/5')
    expect(screen.queryByTestId('printing-scan')).not.toBeInTheDocument()
  })

  it('fades the printing scan in over the default art once it loads', () => {
    render(<CardArt imageId={5} printingId={9} size="small" alt="Kuriboh" />)
    const scan = screen.getByTestId('printing-scan')
    expect(scan).toHaveAttribute('src', 'ygo-img://printing/9')
    expect(scan).toHaveClass('opacity-0')
    fireEvent.load(scan)
    expect(scan).toHaveClass('opacity-100')
    expect(screen.getByAltText('Kuriboh')).toHaveClass('opacity-0')
  })

  it('keeps the default art when the printing has no scan', () => {
    render(<CardArt imageId={5} printingId={9} size="small" alt="Kuriboh" />)
    fireEvent.error(screen.getByTestId('printing-scan'))
    expect(screen.queryByTestId('printing-scan')).not.toBeInTheDocument()
    expect(screen.getByAltText('Kuriboh')).not.toHaveClass('opacity-0')
  })
})
