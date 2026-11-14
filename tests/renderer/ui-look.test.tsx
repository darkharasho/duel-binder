// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Table, TableBody, TableRow, TableCell } from '@/components/ui/table'
import { FilterOptionChip } from '@/components/FilterChip'

describe('shared control look', () => {
  it('buttons are pills', () => {
    const { getByRole } = render(<Button>Go</Button>)
    expect(getByRole('button').className).toContain('rounded-full')
  })
  it('inputs are underline only', () => {
    const { container } = render(<Input />)
    const cls = container.querySelector('input')!.className
    expect(cls).not.toContain('rounded-md')
    expect(cls).toContain('border-b')
    expect(cls).toContain('focus-visible:ring-[3px]')
    expect(cls).toContain('focus-visible:border-b-[3px]')
  })
  it('cards are transparent', () => {
    const { container } = render(<Card />)
    expect(container.firstElementChild!.className).toContain('bg-transparent')
  })
  it('the active chip is inverted', () => {
    const { getByRole } = render(<FilterOptionChip label="A" selected onClick={() => {}} />)
    expect(getByRole('button').className).toContain('bg-chip-on')
  })
  it('table cells are not boxes', () => {
    const { container } = render(
      <Table>
        <TableBody>
          <TableRow>
            <TableCell>1</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    )
    const cls = container.querySelector('td')!.className.split(/\s+/)
    expect(cls).not.toContain('font-mono')
    expect(cls).toContain('tabular-nums')
    expect(cls.filter((c) => /^border(-|$)/.test(c) && c !== 'border-b')).toEqual([])
  })
})
