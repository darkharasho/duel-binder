import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ValueText } from '@/features/collection/EntryValue'

describe('tooltips outside a TooltipProvider', () => {
  // Browse and a friend's binder have no provider; an approximate price there crashed the page.
  it('renders an approximate price with no provider above it', () => {
    render(<ValueText amount={1.23} approximate />)
    expect(screen.getByLabelText('approximately')).toBeInTheDocument()
  })
})
