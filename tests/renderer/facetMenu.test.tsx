import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FacetMenu } from '@/components/FacetMenu'

const OPTIONS = ['Common', 'Rare', 'Super Rare', 'Ultra Rare']

function Harness({ initial = [] }: { initial?: string[] }): React.JSX.Element {
  const [selected, setSelected] = useState(initial)
  return (
    <FacetMenu
      label="Rarity"
      options={OPTIONS}
      selected={selected}
      onChange={(next) => setSelected(next ?? [])}
    />
  )
}

const rows = (): string[] =>
  screen.getAllByRole('checkbox').map((el) => el.closest('label')?.textContent ?? '')

describe('FacetMenu', () => {
  it('searches its options at once, without taking focus', async () => {
    render(<Harness />)
    const search = screen.getByRole('searchbox', { name: 'Search rarity' })
    expect(search).not.toHaveFocus()
    await userEvent.type(search, 'ultra')
    expect(rows()).toEqual(['Ultra Rare'])
  })

  it('lists the selection first', () => {
    render(<Harness initial={['Ultra Rare', 'Rare']} />)
    expect(rows()).toEqual(['Ultra Rare', 'Rare', 'Common', 'Super Rare'])
  })

  it('keeps selected rows on top while searching, and in place while toggling', async () => {
    render(<Harness initial={['Common']} />)
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search rarity' }), 'super')
    expect(rows()).toEqual(['Common', 'Super Rare'])

    await userEvent.click(screen.getByRole('checkbox', { name: 'Common' }))
    expect(screen.getByRole('checkbox', { name: 'Common' })).not.toBeChecked()
    expect(rows()).toEqual(['Common', 'Super Rare'])
  })
})
