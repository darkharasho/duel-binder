import { useState } from 'react'
import { act, render, renderHook, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { YGO } from '@shared/games/ygo'
import { PKM } from '@shared/games/pokemon'
import { FilterBar } from '@/components/FilterBar'
import { FilterPanel, FilterSection } from '@/components/FilterPanel'
import { SearchInput } from '@/components/SearchInput'
import { SortControl } from '@/components/SortControl'
import {
  cardFilterChips,
  clearedFilters,
  facetsFor,
  languageChip,
  matchesSetSearch,
  sortOptions
} from '@/lib/filters'
import { rangeFilters } from '@/lib/rangeFilters'
import { useFilterPanel } from '@/lib/useFilterPanel'
import { stubWideWindow } from './filterTestHelpers'

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('SearchInput', () => {
  it('passes text on after a 200ms pause, once', () => {
    vi.useFakeTimers()
    try {
      const onChange = vi.fn()
      render(<SearchInput label="Search" value="" onChange={onChange} />)
      const box = screen.getByRole('searchbox', { name: 'Search' })
      act(() => {
        fireInput(box, 'd')
        vi.advanceTimersByTime(150)
        fireInput(box, 'da')
        vi.advanceTimersByTime(199)
      })
      expect(onChange).not.toHaveBeenCalled()
      act(() => {
        vi.advanceTimersByTime(1)
      })
      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith('da')
    } finally {
      vi.useRealTimers()
    }
  })

  it('hands over text still waiting when it is removed, and only then', () => {
    vi.useFakeTimers()
    try {
      const onChange = vi.fn()
      const first = render(<SearchInput label="Search" value="" onChange={onChange} />)
      act(() => {
        fireInput(screen.getByRole('searchbox'), 'gamma')
      })
      first.unmount()
      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith('gamma')

      onChange.mockClear()
      const second = render(<SearchInput label="Search" value="" onChange={onChange} />)
      act(() => {
        fireInput(screen.getByRole('searchbox'), 'd')
        vi.advanceTimersByTime(200)
      })
      expect(onChange).toHaveBeenCalledTimes(1)
      second.unmount()
      expect(onChange).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('follows a value cleared from outside', () => {
    const { rerender } = render(<SearchInput label="Search" value="dark" onChange={() => {}} />)
    expect(screen.getByRole('searchbox')).toHaveValue('dark')
    rerender(<SearchInput label="Search" value="" onChange={() => {}} />)
    expect(screen.getByRole('searchbox')).toHaveValue('')
  })

  it('with no debounce answers each key, and uses the label as placeholder by default', async () => {
    function Harness(): React.JSX.Element {
      const [q, setQ] = useState('')
      return (
        <>
          <SearchInput label="Search sets" value={q} onChange={setQ} debounceMs={0} />
          <output>{q}</output>
        </>
      )
    }
    render(<Harness />)
    await userEvent.type(screen.getByPlaceholderText('Search sets'), 'ab')
    expect(screen.getByRole('status')).toHaveTextContent('ab')
  })
})

function fireInput(box: HTMLElement, value: string): void {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  set?.call(box, value)
  box.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('FilterBar', () => {
  const chip = { key: 'a', label: 'Rare', onRemove: vi.fn() }

  it('takes no second row with nothing active', () => {
    render(<FilterBar onToggleFilters={() => {}} onClearAll={() => {}} resultCount="3 cards" />)
    const button = screen.getByRole('button', { name: 'Filters' })
    expect(button.className).toContain('border')
    expect(screen.queryByRole('button', { name: 'Clear all' })).not.toBeInTheDocument()
    expect(screen.queryByText('3 cards')).not.toBeInTheDocument()
  })

  it('counts its chips on a filled Filters button, with Clear all and the result count', async () => {
    const onClearAll = vi.fn()
    render(
      <FilterBar
        onToggleFilters={() => {}}
        chips={[chip]}
        onClearAll={onClearAll}
        resultCount="3 cards"
      />
    )
    const button = screen.getByRole('button', { name: 'Filters, 1 active' })
    expect(button).toHaveTextContent('Filters1')
    expect(button.className).toContain('bg-primary')
    expect(screen.getByText('3 cards')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(onClearAll).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Remove Rare filter' }))
    expect(chip.onRemove).toHaveBeenCalled()
  })
})

describe('SortControl', () => {
  it('shows the sort with its direction, and answers with both', async () => {
    const onChange = vi.fn()
    const options = sortOptions([
      { value: 'price', label: 'Price', kind: 'number', dir: 'desc' },
      { value: 'name', label: 'Name', kind: 'text', dir: 'asc' }
    ])
    render(<SortControl options={options} value="price" dir="desc" onChange={onChange} />)
    const box = screen.getByRole('combobox', { name: 'Sort by' })
    expect(box).toHaveTextContent('Price: high to low')
    await userEvent.click(box)
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual([
      'Price: high to low',
      'Price: low to high',
      'Name: A to Z',
      'Name: Z to A'
    ])
    await userEvent.click(screen.getByRole('option', { name: 'Name: Z to A' }))
    expect(onChange).toHaveBeenCalledWith('name', 'desc')
  })
})

describe('filter helpers', () => {
  it('Race is a Browse facet, not a collection one', () => {
    expect(facetsFor(YGO).map((f) => f.key)).not.toContain('races')
    expect(facetsFor(YGO, 'browse').map((f) => f.key)).toContain('races')
    expect(facetsFor(PKM).at(-1)).toEqual({ key: 'rarities', label: 'Version' })
  })

  it('makes one chip per value and per set range; language adds one unless All', () => {
    const onChange = vi.fn()
    const chips = cardFilterChips(
      { rarities: ['Rare', 'Common'], setNames: ['Metal Raiders'], levelMin: 4 },
      facetsFor(YGO),
      rangeFilters(YGO.filters),
      (s) => `MRD - ${s}`,
      onChange
    )
    expect(chips.map((c) => c.label)).toEqual(['MRD - Metal Raiders', 'Rare', 'Common', 'Level 4–'])
    expect(chips.length + languageChip('ja', () => {}).length).toBe(5)
    expect(chips.length + languageChip('all', () => {}).length).toBe(5)
    expect(chips.length + languageChip('en', () => {}).length).toBe(4)

    chips[1].onRemove()
    expect(onChange).toHaveBeenLastCalledWith({ rarities: ['Common'] })
    chips[3].onRemove()
    expect(onChange).toHaveBeenLastCalledWith({ levelMin: undefined, levelMax: undefined })
  })

  it('the default language has no chip; any other has one that goes back to the default', () => {
    expect(languageChip('en', () => {})).toEqual([])
    const set = vi.fn()
    const [ja] = languageChip('ja', set)
    expect(ja.label).toBe('Japanese')
    ja.onRemove()
    expect(set).toHaveBeenLastCalledWith('en')
    const [all] = languageChip('all', set)
    expect(all.label).toBe('All languages')
    set.mockClear()
    all.onRemove()
    expect(set).toHaveBeenCalledWith('en')
  })

  it('clearing keeps the search and sort and nothing else', () => {
    expect(
      clearedFilters({ q: 'dark', sort: 'name', dir: 'asc', rarities: ['Rare'], hpMin: 3 }, {
        sort: 'added',
        dir: 'desc'
      } as never)
    ).toEqual({ q: 'dark', sort: 'name', dir: 'asc' })
  })

  it('matches a set by name, English name or code', () => {
    const set = { setName: 'Metal Raiders', setCode: 'MRD' }
    expect(matchesSetSearch(set, ' mrd ')).toBe(true)
    expect(matchesSetSearch(set, 'raiders')).toBe(true)
    expect(matchesSetSearch(set, '')).toBe(true)
    expect(matchesSetSearch(set, 'lob')).toBe(false)
  })
})

describe('FilterPanel', () => {
  function Page(): React.JSX.Element {
    const { wide, open, setOpen } = useFilterPanel()
    return (
      <>
        <button type="button" onClick={() => setOpen(!open)}>
          Toggle
        </button>
        <FilterPanel wide={wide} open={open} onOpenChange={setOpen} description="Filter">
          <FilterSection title="Rarity" defaultOpen>
            Options
          </FilterSection>
        </FilterPanel>
      </>
    )
  }

  it('is a bottom sheet in a narrow window, opened afresh each time', async () => {
    const first = render(<Page />)
    await userEvent.click(screen.getByRole('button', { name: 'Toggle' }))
    expect(await screen.findByRole('dialog', { name: 'Filters' })).toHaveAttribute(
      'data-layout',
      'bottom-sheet'
    )
    first.unmount()
    expect(localStorage.getItem('filters.panelOpen')).toBeNull()
    render(<Page />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('is a side panel in a wide window, remembered until closed', async () => {
    stubWideWindow()
    const first = render(<Page />)
    await userEvent.click(screen.getByRole('button', { name: 'Toggle' }))
    const panel = screen.getByRole('complementary', { name: 'Filters' })
    expect(panel.className).toContain('w-80')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    first.unmount()

    render(<Page />)
    await userEvent.click(
      within(screen.getByRole('complementary')).getByRole('button', { name: 'Close filters' })
    )
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    expect(localStorage.getItem('filters.panelOpen')).toBe('closed')
  })

  it('a section opens and closes from its heading', async () => {
    render(
      <FilterSection title="HP" picked={1}>
        Inside
      </FilterSection>
    )
    expect(screen.queryByText('Inside')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'HP, 1 selected' }))
    expect(screen.getByText('Inside')).toBeInTheDocument()
  })

  it('all components share the hook state', () => {
    stubWideWindow()
    const a = renderHook(() => useFilterPanel())
    const b = renderHook(() => useFilterPanel())
    act(() => a.result.current.setOpen(true))
    expect(b.result.current.open).toBe(true)
    act(() => a.result.current.setOpen(false))
  })
})
