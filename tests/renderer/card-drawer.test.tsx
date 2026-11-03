import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { CardDrawer } from '@/components/CardDrawer'
import { createMockApi, renderWithProviders } from './mockApi'

function renderDrawer(platform: 'phone' | 'linux'): void {
  renderWithProviders(
    <CardDrawer header={<h2>Dark Magician</h2>} art={<img alt="art" />}>
      <p>Spellcaster · DARK</p>
    </CardDrawer>,
    { api: createMockApi({ window: { platform } }) }
  )
}

describe('CardDrawer', () => {
  it('on the phone, puts the title and details on a drawer below the pinned art, shown at once', () => {
    renderDrawer('phone')
    const drawer = screen.getByRole('region', { name: 'Card details' })
    expect(within(drawer).getByRole('heading', { name: 'Dark Magician' })).toBeVisible()
    expect(within(drawer).getByText('Spellcaster · DARK')).toBeVisible()
    const art = screen.getByRole('img', { name: 'art' })
    expect(drawer).not.toContainElement(art)
    expect(art.parentElement!.className).toContain('sticky')
  })

  it('on desktop, keeps the plain column with no drawer', () => {
    renderDrawer('linux')
    expect(screen.queryByRole('region', { name: 'Card details' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Dark Magician' })).toBeVisible()
  })

  it('on the phone, only tucks the drawer up over art that is there', () => {
    renderWithProviders(
      <CardDrawer header={<h2>Dark Magician</h2>} art={false}>
        <p>Spellcaster · DARK</p>
      </CardDrawer>,
      { api: createMockApi({ window: { platform: 'phone' } }) }
    )
    expect(screen.getByRole('region', { name: 'Card details' }).className).not.toContain('-mt-6')
  })
  it('on the phone, leaves a gap between the card and the drawer instead of covering it', () => {
    renderDrawer('phone')
    const drawer = screen.getByRole('region', { name: 'Card details' })
    expect(drawer.className).not.toContain('-mt-6')
    expect(drawer.className).toContain('mt-6')
  })

  it('on the phone, eases the card back as the drawer is scrolled up over it', async () => {
    renderWithProviders(
      <div data-testid="scroller" style={{ overflowY: 'auto' }}>
        <CardDrawer header={<h2>Dark Magician</h2>} art={<img alt="art" />}>
          <p>Spellcaster · DARK</p>
        </CardDrawer>
      </div>,
      { api: createMockApi({ window: { platform: 'phone' } }) }
    )
    const scroller = screen.getByTestId('scroller')
    const art = screen.getByRole('img', { name: 'art' }).parentElement!
    Object.defineProperty(art, 'offsetHeight', { value: 400 })
    scroller.scrollTop = 200
    fireEvent.scroll(scroller)
    await waitFor(() =>
      expect(Number(art.style.getPropertyValue('--drawer-p'))).toBeGreaterThan(0.5)
    )
    expect(Number(art.style.getPropertyValue('--drawer-p'))).toBeLessThan(1)
    scroller.scrollTop = 900
    fireEvent.scroll(scroller)
    await waitFor(() => expect(art.style.getPropertyValue('--drawer-p')).toBe('1'))
    scroller.scrollTop = 0
    fireEvent.scroll(scroller)
    await waitFor(() => expect(art.style.getPropertyValue('--drawer-p')).toBe('0'))
  })
})
