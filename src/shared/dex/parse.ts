/** One row of a Dex (the Pokémon TCG collection app) CSV export, with the columns the import reads. */
export interface DexRow {
  locale: string
  series: string
  set: string
  id: string
  number: string
  name: string
  variant: string
  /** Null when the Quantity column isn't a whole number. */
  quantity: number | null
}

/** A far bigger export than a full collection, to bound what crosses to the main process. */
export const MAX_DEX_ROWS = 200_000

export class DexFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DexFormatError'
  }
}

const COLUMNS = ['Locale', 'Series', 'Set', 'Id', 'Number', 'Name', 'Variant', 'Quantity'] as const

/** Dex exports UTF-16 LE with a BOM; a file resaved by a spreadsheet may be UTF-16 BE or UTF-8. */
export function decodeDexFile(bytes: Uint8Array): string {
  const encoding =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? 'utf-16le'
      : bytes[0] === 0xfe && bytes[1] === 0xff
        ? 'utf-16be'
        : 'utf-8'
  return new TextDecoder(encoding).decode(bytes)
}

/** Semicolon-separated records; a quoted field may hold semicolons, line breaks and doubled quotes. */
function records(text: string): string[][] {
  const out: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c !== '"') field += c
      else if (text[i + 1] === '"') {
        field += '"'
        i++
      } else quoted = false
    } else if (c === '"' && field === '') quoted = true
    else if (c === ';') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      out.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    out.push(row)
  }
  return out
}

/** The rows of a decoded export. Throws DexFormatError when its header isn't a Dex one. */
export function parseDexCsv(text: string): DexRow[] {
  const [header, ...rows] = records(text.replace(/^\uFEFF/, ''))
  const at = Object.fromEntries(COLUMNS.map((c) => [c, header?.indexOf(c) ?? -1])) as Record<
    (typeof COLUMNS)[number],
    number
  >
  if (Object.values(at).some((i) => i < 0)) throw new DexFormatError("This isn't a Dex CSV export.")
  return rows
    .filter((r) => r.some((f) => f.trim() !== ''))
    .map((r) => {
      const get = (c: (typeof COLUMNS)[number]): string => (r[at[c]] ?? '').trim()
      const quantity = get('Quantity')
      return {
        locale: get('Locale'),
        series: get('Series'),
        set: get('Set'),
        id: get('Id'),
        number: get('Number'),
        name: get('Name'),
        variant: get('Variant'),
        quantity: /^\d+$/.test(quantity) ? Number(quantity) : null
      }
    })
}
