import { describe, expect, it } from 'vitest'
import { DexFormatError, decodeDexFile, parseDexCsv } from '../../src/shared/dex/parse'

const HEADER =
  'Type;Category;Locale;Series;Set;Id;Number;Name;Variant;Rarity;Illustrator;Quantity;Price;Note 1;Note 2;Note 3;Note 4;Note 5'
const utf16 = (text: string): Uint8Array => new Uint8Array(Buffer.from(`\uFEFF${text}`, 'utf16le'))

describe('Dex CSV', () => {
  it('reads UTF-16 LE with a BOM, semicolons and CRLF', () => {
    const file = [
      HEADER,
      'collection;Prismatic Evolutions;International;Scarlet & Violet;Prismatic Evolutions;sv85-1;1/131;Exeggcute;Poké Ball Holo;Common;Iori Suzuki;2;$0.33;;;;;',
      ''
    ].join('\r\n')
    expect(parseDexCsv(decodeDexFile(utf16(file)))).toEqual([
      {
        locale: 'International',
        series: 'Scarlet & Violet',
        set: 'Prismatic Evolutions',
        id: 'sv85-1',
        number: '1/131',
        name: 'Exeggcute',
        variant: 'Poké Ball Holo',
        quantity: 2
      }
    ])
  })

  it('keeps semicolons, quotes and line breaks inside a quoted field', () => {
    const file = `${HEADER}\r\nsmart;"My; ""best"" list";International;EX;EX Dragon;ex3-1;1/97;"Odd; ""Mew""\r\nline";Holo;Rare;A;1;—;;;;;\r\n`
    const [row] = parseDexCsv(file)
    expect(row.name).toBe('Odd; "Mew"\r\nline')
    expect(row.variant).toBe('Holo')
    expect(row.quantity).toBe(1)
  })

  it('reads a UTF-8 copy and a last line with no line break', () => {
    const bytes = new TextEncoder().encode(
      `${HEADER}\ncollection;L;International;S;Set;a-1;1/2;Mew;Normal;R;I;0;—;;;;;`
    )
    expect(parseDexCsv(decodeDexFile(bytes))).toHaveLength(1)
  })

  it('gives a row with a bad quantity no quantity and skips blank lines', () => {
    const rows = parseDexCsv(
      `${HEADER}\r\ncollection;L;International;S;Set;a-1;1/2;Mew;Normal;R;I;two;—;;;;;\r\n;;;\r\n`
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].quantity).toBeNull()
  })

  it('refuses a file that is not a Dex export', () => {
    expect(() => parseDexCsv('name,qty\nMew,1\n')).toThrow(DexFormatError)
    expect(() => parseDexCsv('')).toThrow(DexFormatError)
  })
})
