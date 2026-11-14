import { render } from '@testing-library/react'
import { Heart } from 'lucide-react'
import { EmptySteps } from '@/components/EmptyHero'

describe('EmptySteps', () => {
  it('draws no box around a step', () => {
    const { container } = render(
      <EmptySteps steps={[{ icon: Heart, title: 'One', text: 'First step' }]} />
    )
    const li = container.querySelector('li') as HTMLElement
    expect(li.className).not.toMatch(/\bborder\b|bg-card/)
    expect(container.innerHTML).not.toMatch(/bg-card/)
  })
})
