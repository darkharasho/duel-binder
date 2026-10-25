import { useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
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
  screen.getAllByRole('menuitemcheckbox').map((el) => el.textContent ?? '')

describe('FacetMenu', () => {
  it('has a search box even for short lists, focused on open', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'Rarity' }))
    const search = await screen.findByRole('textbox', { name: 'Search rarity' })
    await waitFor(() => expect(search).toHaveFocus())
    await userEvent.type(search, 'ultra')
    expect(rows()).toEqual(['Ultra Rare'])
  })

  it('lists the selection first when opened', async () => {
    render(<Harness initial={['Ultra Rare', 'Rare']} />)
    await userEvent.click(screen.getByRole('button', { name: 'Rarity' }))
    await screen.findByRole('textbox', { name: 'Search rarity' })
    expect(rows()).toEqual(['Ultra Rare', 'Rare', 'Common', 'Super Rare'])
  })

  it('keeps selected rows on top while searching, and in place while toggling', async () => {
    render(<Harness initial={['Common']} />)
    await userEvent.click(screen.getByRole('button', { name: 'Rarity' }))
    await userEvent.type(await screen.findByRole('textbox', { name: 'Search rarity' }), 'super')
    expect(rows()).toEqual(['Common', 'Super Rare'])

    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Common' }))
    expect(screen.getByRole('menuitemcheckbox', { name: 'Common' })).not.toBeChecked()
    expect(rows()).toEqual(['Common', 'Super Rare'])
  })
})
