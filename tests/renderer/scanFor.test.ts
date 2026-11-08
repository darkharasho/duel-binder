import { describe, expect, it } from 'vitest'
import { binderScanFor, rarityScanFor, scanFor } from '@/components/scanFor'
import type { BinderCard, ChecklistRarity, EntryView } from '@shared/types'

const printing = { id: 340946 } as EntryView['printing']

describe('which printing photo shows', () => {
  it("an entry shows its printing's; a friend's, this catalog's twin of it", () => {
    expect(scanFor({ printing, printingScan: true })).toBe(340946)
    expect(scanFor({ printing, printingScan: false, photoPrintingId: 339709 })).toBe(339709)
    // The server's id is never used as this catalog's.
    expect(scanFor({ printing, printingScan: false, photoPrintingId: null })).toBeNull()
    expect(scanFor({ printing, printingScan: false })).toBeNull()
  })

  it('a binder slot, which may have no printing', () => {
    const c = { printing, printingScan: true } as Pick<BinderCard, 'printing' | 'printingScan'>
    expect(binderScanFor(c)).toBe(340946)
    expect(binderScanFor({ ...c, printing: null })).toBeNull()
    expect(binderScanFor({ ...c, printingScan: false, photoPrintingId: 339709 })).toBe(339709)
  })

  it("a checklist rarity: its default printing, or a friend's checklist's twin", () => {
    const r = { defaultPrintingId: 340946 } as ChecklistRarity
    expect(rarityScanFor(r)).toBe(340946)
    expect(rarityScanFor({ ...r, photoPrintingId: 339709 })).toBe(339709)
    expect(rarityScanFor({ ...r, photoPrintingId: null })).toBeNull()
    expect(rarityScanFor(undefined)).toBeUndefined()
  })
})
