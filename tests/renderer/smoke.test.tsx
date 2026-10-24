import { render, screen } from '@testing-library/react'

test('jsdom + testing-library work', () => {
  render(<button>hi</button>)
  expect(screen.getByRole('button', { name: 'hi' })).toBeInTheDocument()
})
