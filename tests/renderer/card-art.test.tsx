import { fireEvent, render, screen } from '@testing-library/react'
import { CardArt } from '@/components/CardArt'
import { createMockApi } from './mockApi'

describe('CardArt', () => {
  it('without a printing it is the plain default art', () => {
    render(<CardArt imageId={5} size="small" alt="Kuriboh" />)
    expect(screen.getByAltText('Kuriboh')).toHaveAttribute('src', 'ygo-img://small/5')
    expect(screen.queryByTestId('printing-scan')).not.toBeInTheDocument()
  })

  it('shimmers in the frame while the art downloads, then fades it in', () => {
    render(<CardArt imageId={5} size="small" alt="Kuriboh" />)
    const img = screen.getByAltText('Kuriboh')
    expect(img).toHaveClass('art-loading')
    fireEvent.load(img)
    expect(img).not.toHaveClass('art-loading')
    expect(img).toHaveClass('art-reveal')
  })

  it('with a printing, the frame shimmers until the default art loads', () => {
    const { container } = render(<CardArt imageId={5} printingId={9} size="small" alt="Kuriboh" />)
    const frame = container.firstElementChild!
    expect(frame).toHaveClass('art-loading')
    fireEvent.load(screen.getByAltText('Kuriboh'))
    expect(frame).not.toHaveClass('art-loading')
    expect(screen.getByAltText('Kuriboh')).toHaveClass('art-reveal')
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

  it('on the phone it shows the default art and no printing scan', () => {
    const saved = window.api
    window.api = createMockApi({ window: { platform: 'phone' } })
    try {
      render(<CardArt imageId={5} printingId={9} size="small" alt="Kuriboh" />)
      expect(screen.getByAltText('Kuriboh')).toHaveAttribute('src', '/img/small/5')
      expect(screen.queryByTestId('printing-scan')).not.toBeInTheDocument()
    } finally {
      window.api = saved
    }
  })
})
