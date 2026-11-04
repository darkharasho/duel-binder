import { BANDAI_ID_RE } from '../imageSources'
import { languageInfo } from '../languages'
import { onePieceImageId } from './ids'
import type { GameDef } from './types'

export const OP_CARD_TYPES = ['Leader', 'Character', 'Event', 'Stage', 'DON!!'] as const
export const OP_RARITIES = ['L', 'C', 'UC', 'R', 'SR', 'SEC', 'SP', 'TR', 'P'] as const
export const OP_ATTRIBUTES = ['Strike', 'Slash', 'Ranged', 'Special', 'Wisdom'] as const

/**
 * SQL for the version of a printing label in `col`: the text between its first ` (` and its final
 * `)` (`SR (Alternate Art)` is `Alternate Art`, `SR (Alternate Art 2)` is `Alternate Art 2`, a
 * promo's product name), else `'Base'`: a label with no ` (` (`SR`), or one whose remainder is all
 * digits (`SP (2)`). A number is kept, not stripped: it would also cut product names (`… Season 1`).
 */
export function opVersionSql(col: string): string {
  const rest = `substr(${col}, instr(${col}, ' (') + 2)`
  const inner = `(CASE WHEN substr(${rest}, -1) = ')' THEN substr(${rest}, 1, length(${rest}) - 1) ELSE ${rest} END)`
  return `(CASE WHEN instr(${col}, ' (') = 0 OR ${inner} NOT GLOB '*[^0-9]*' THEN 'Base' ELSE ${inner} END)`
}

/**
 * The art image of a One Piece printing: its `set_rarity_code` is the Bandai entry it was written
 * from (`OP01-001_p1`), which names the image. Null when the code is empty or not a Bandai id.
 */
export function opPrintingImageId(language: string, setRarityCode: string): number | null {
  return setRarityCode && BANDAI_ID_RE.test(setRarityCode)
    ? onePieceImageId(language, setRarityCode)
    : null
}

export const ONE_PIECE: GameDef = {
  id: 'op',
  name: 'One Piece',
  color: '#3b82c4',
  features: { scan: false, rip: false },
  cardAspect: { width: 600, height: 838 },
  crossLanguagePriceFallback: false,
  priceRule: 'marketOnly',
  access: 'testers',
  vocab: {
    cardId: 'Card',
    printingCode: 'Card number',
    rarity: 'Rarity',
    regionLabel: (lang) => languageInfo(lang).label
  },
  filters: [
    { key: 'opColors', label: 'Color', kind: 'multi' },
    { key: 'opCardTypes', label: 'Card type', kind: 'multi' },
    { key: 'opAttributes', label: 'Attribute', kind: 'multi' },
    { key: 'opTraits', label: 'Trait', kind: 'multi' },
    { key: 'opRarities', label: 'Rarity', kind: 'multi' },
    { key: 'opVersions', label: 'Version', kind: 'multi' },
    { key: 'opBlocks', label: 'Block', kind: 'multi' },
    { key: 'cost', label: 'Cost', kind: 'range' },
    { key: 'power', label: 'Power', kind: 'range' },
    { key: 'counter', label: 'Counter', kind: 'range' }
  ],
  details: [
    { key: 'cardType', label: 'Card type' },
    { key: 'colors', label: 'Color' },
    { key: 'cost', label: 'Cost' },
    { key: 'life', label: 'Life' },
    { key: 'power', label: 'Power' },
    { key: 'counter', label: 'Counter' },
    { key: 'attribute', label: 'Attribute' },
    { key: 'traits', label: 'Traits' },
    { key: 'blockIcon', label: 'Block' },
    { key: 'number', label: 'Card number' }
  ]
}
