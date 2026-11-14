import { render, screen } from '@testing-library/react'
import { PageHeader } from '@/components/PageHeader'

const header = (): React.JSX.Element => (
  <PageHeader
    title="Collection"
    stats={[
      { label: 'Cards', value: '1,204' },
      { label: 'Value', value: '$311.40' }
    ]}
  >
    <p>filters</p>
  </PageHeader>
)

describe('PageHeader', () => {
  it('renders a display h1', () => {
    render(header())
    expect(screen.getByRole('heading', { level: 1, name: 'Collection' })).toHaveClass(
      'font-display'
    )
  })

  it('sets each stat value in mono, with its label beneath', () => {
    render(header())
    expect(screen.getByText('1,204')).toHaveClass('font-mono')
    expect(screen.getByText('$311.40')).toHaveClass('font-mono')
    expect(screen.getByText('Cards')).toHaveClass('uppercase')
  })

  it('has no blur or tinted box', () => {
    const { container } = render(header())
    const el = container.querySelector('[data-page-header]') as HTMLElement
    expect(el.className).not.toContain('backdrop-blur')
    expect(el.className).not.toContain('bg-background')
  })

  it('on the phone stacks the stats under the title, left-aligned', async () => {
    vi.resetModules()
    vi.doMock('@/lib/platform', () => ({ isPhone: () => true }))
    const { PageHeader: Phone } = await import('@/components/PageHeader')
    const { container } = render(<Phone title="Sets" stats={[{ label: 'Cards', value: '1' }]} />)
    const dl = container.querySelector('dl') as HTMLElement
    expect(dl).toHaveClass('justify-start', 'text-left')
    expect(dl.parentElement).toHaveClass('flex-col')
    expect(screen.getByText('1')).toHaveClass('text-[22px]')
    vi.doUnmock('@/lib/platform')
  })

  it('still renders its children', () => {
    render(header())
    expect(screen.getByText('filters')).toBeInTheDocument()
  })
})
