import type { SetChecklist } from '@shared/types'

// Task 4's Metal Raiders data shape. Printing ids are distinct per code.
export const PRINTING = {
  alphaSecret: 101,
  alphaUltra001: 102,
  alphaUltraE001: 103,
  alphaUltraEN001: 104,
  beta: 201,
  gammaE010: 301,
  gammaEN010: 302
} as const

export const metalRaidersChecklist: SetChecklist = {
  set: {
    language: 'en',
    setName: 'Metal Raiders',
    setCode: 'MRD',
    tcgDate: '2002-06-26',
    imageKey: 'MRD',
    coverImageId: null,
    totalCards: 3,
    ownedCards: 1,
    totalRarities: 4,
    ownedRarities: 1,
    listRows: null,
    unmatchedRows: null
  },
  cards: [
    {
      cardId: 1001,
      name: 'Alpha Dragon',
      type: 'Normal Monster',
      number: 1,
      numberLabel: '001',
      imageId: 1001,
      owned: 2,
      entryId: 7,
      rarities: [
        {
          rarity: 'Secret Rare',
          owned: 0,
          codes: [{ printingId: PRINTING.alphaSecret, setCode: 'MRD-001', owned: 0 }],
          defaultPrintingId: PRINTING.alphaSecret,
          entryId: null
        },
        {
          rarity: 'Ultra Rare',
          owned: 2,
          codes: [
            { printingId: PRINTING.alphaUltra001, setCode: 'MRD-001', owned: 0 },
            { printingId: PRINTING.alphaUltraE001, setCode: 'MRD-E001', owned: 2 },
            { printingId: PRINTING.alphaUltraEN001, setCode: 'MRD-EN001', owned: 0 }
          ],
          defaultPrintingId: PRINTING.alphaUltraE001,
          entryId: 7
        }
      ]
    },
    {
      cardId: 2001,
      name: 'Beta Knight',
      type: 'Effect Monster',
      number: 2,
      numberLabel: '002',
      imageId: 2001,
      owned: 0,
      entryId: null,
      rarities: [
        {
          rarity: 'Common',
          owned: 0,
          codes: [{ printingId: PRINTING.beta, setCode: 'MRD-002', owned: 0 }],
          defaultPrintingId: PRINTING.beta,
          entryId: null
        }
      ]
    },
    {
      cardId: 3001,
      name: 'Gamma Trap',
      type: 'Trap Card',
      number: 10,
      numberLabel: '010',
      imageId: 3001,
      owned: 0,
      entryId: null,
      rarities: [
        {
          rarity: 'Rare',
          owned: 0,
          codes: [
            { printingId: PRINTING.gammaE010, setCode: 'MRD-E010', owned: 0 },
            { printingId: PRINTING.gammaEN010, setCode: 'MRD-EN010', owned: 0 }
          ],
          defaultPrintingId: PRINTING.gammaEN010,
          entryId: null
        }
      ]
    }
  ]
}
