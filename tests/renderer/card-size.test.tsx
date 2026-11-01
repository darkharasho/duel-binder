import { afterEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { CardSizePicker } from '@/components/CardSizePicker'

const scale = (): string => document.documentElement.style.getPropertyValue('--card-scale')

describe('CardSizePicker', () => {
  afterEach(() => {
    fireEvent.click(screen.getByRole('radio', { name: 'Small cards' }))
  })

  it("sets the grids' scale and remembers the size", () => {
    render(<CardSizePicker />)
    expect(scale()).toBe('1')
    fireEvent.click(screen.getByRole('radio', { name: 'Large cards' }))
    expect(scale()).toBe('1.9')
    expect(localStorage.getItem('cards.size')).toBe('large')
    fireEvent.click(screen.getByRole('radio', { name: 'Medium cards' }))
    expect(scale()).toBe('1.4')
  })

  it('keeps a size when its own button is clicked again', () => {
    render(<CardSizePicker />)
    fireEvent.click(screen.getByRole('radio', { name: 'Small cards' }))
    expect(scale()).toBe('1')
  })
})
