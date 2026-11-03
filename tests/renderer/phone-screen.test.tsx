import { render, screen } from '@testing-library/react'
import { PhoneScreen } from '../../src/phone/PhoneScreen'

describe('PhoneScreen', () => {
  it('draws drifting blobs behind the content, hidden from screen readers and motion-safe', () => {
    render(
      <PhoneScreen>
        <h1>Downloading</h1>
      </PhoneScreen>
    )
    const blobs = screen.getByTestId('phone-blobs')
    expect(blobs).toHaveAttribute('aria-hidden')
    expect(blobs.children.length).toBe(3)
    for (const b of blobs.children) {
      expect(b.className).toContain('motion-reduce:animate-none')
      expect(b.className).toMatch(/animation:phone-blob-/)
    }
    expect(screen.getByRole('heading', { name: 'Downloading' })).toBeVisible()
  })
})
