import { describe, expect, it } from 'vitest'
import {
  choosePrintingFile,
  choosePrintingScan,
  fileShowsVariant,
  needsOwnScan,
  printingPhotoSuffix,
  rarityAbbr
} from '../../src/main/yugipedia/printingArt'

const BEWD = [
  'File:BlueEyesWhiteDragon-LB-JP-UR.jpg',
  'File:BlueEyesWhiteDragon-LDK2-EN-C-1E-2.png',
  'File:BlueEyesWhiteDragon-LDK2-EN-C-1E.png',
  'File:BlueEyesWhiteDragon-LDK2-EN-C-UE.png',
  'File:BlueEyesWhiteDragon-LOB-DE-UR-1E.png',
  'File:BlueEyesWhiteDragon-LOB-EN-UR-UE-25thAnniversaryEdition.png',
  'File:BlueEyesWhiteDragon-LOB-EN-UR-UE.png',
  'File:BlueEyesWhiteDragon-LOB-NA-UR-1E.jpg',
  'File:BlueEyesWhiteDragon-LOB-EU-UR-1E.png',
  'File:BlueEyesWhiteDragon-SDK-NA-UR-1E.png',
  'File:BlueEyesWhiteDragon-SDK-NA-C-UE.png',
  'File:BlueEyesWhiteDragon-LOB-KR-UR-1E.png'
]

describe('choosePrintingFile', () => {
  it("takes an overframe from its rarity's scan when Yugipedia names no variant (RV01)", () => {
    const files = [
      'File:BlueEyesToonDragon-RV01-JP-C.png',
      'File:BlueEyesToonDragon-RV01-JP-OP.png',
      'File:BlueEyesToonDragon-RV01-JP-ScR.png'
    ]
    const printing = {
      setCode: 'RV01-JP008',
      language: 'ja' as const,
      rarity: 'Secret Rare',
      variant: 'Overframe'
    }
    expect(choosePrintingFile(files, printing)).toBe('BlueEyesToonDragon-RV01-JP-ScR.png')
  })

  it('picks the set, region and rarity, preferring the plain file', () => {
    expect(
      choosePrintingFile(BEWD, { setCode: 'LOB-EN001', language: 'en', rarity: 'Ultra Rare' })
    ).toBe('BlueEyesWhiteDragon-LOB-EN-UR-UE.png')
  })

  it('follows the region in English set codes', () => {
    expect(
      choosePrintingFile(BEWD, { setCode: 'LOB-E001', language: 'en', rarity: 'Ultra Rare' })
    ).toBe('BlueEyesWhiteDragon-LOB-EU-UR-1E.png')
    expect(
      choosePrintingFile(BEWD, { setCode: 'LOB-001', language: 'en', rarity: 'Ultra Rare' })
    ).toBe('BlueEyesWhiteDragon-LOB-NA-UR-1E.jpg')
  })

  it('falls back to older English regions', () => {
    expect(
      choosePrintingFile(BEWD, { setCode: 'SDK-001', language: 'en', rarity: 'Ultra Rare' })
    ).toBe('BlueEyesWhiteDragon-SDK-NA-UR-1E.png')
  })

  it('uses the rarity code when stored, and other languages their region', () => {
    expect(
      choosePrintingFile(BEWD, {
        setCode: 'SDK-001',
        language: 'en',
        rarity: 'Common',
        rarityCode: '(C)'
      })
    ).toBe('BlueEyesWhiteDragon-SDK-NA-C-UE.png')
    expect(
      choosePrintingFile(BEWD, { setCode: 'LB-01', language: 'ja', rarity: 'Ultra Rare' })
    ).toBe('BlueEyesWhiteDragon-LB-JP-UR.jpg')
    expect(
      choosePrintingFile(BEWD, { setCode: 'LOB-DE001', language: 'de', rarity: 'Ultra Rare' })
    ).toBe('BlueEyesWhiteDragon-LOB-DE-UR-1E.png')
  })

  it('prefers 1st Edition over Unlimited, and the base art over alternates', () => {
    expect(
      choosePrintingFile(BEWD, { setCode: 'LDK2-ENK01', language: 'en', rarity: 'Common' })
    ).toBe('BlueEyesWhiteDragon-LDK2-EN-C-1E.png')
  })

  it('takes another rarity of the same set over nothing, and null when the set is absent', () => {
    expect(
      choosePrintingFile(BEWD, { setCode: 'LOB-EN001', language: 'en', rarity: 'Secret Rare' })
    ).toBe('BlueEyesWhiteDragon-LOB-EN-UR-UE.png')
    expect(
      choosePrintingFile(BEWD, { setCode: 'MRD-EN001', language: 'en', rarity: 'Ultra Rare' })
    ).toBeNull()
    expect(
      choosePrintingFile(BEWD, { setCode: 'LOB-IT001', language: 'it', rarity: 'Ultra Rare' })
    ).toBeNull()
  })
})

const GAGAGA = [
  'File:GagagaGirlCellPhoneSubtraction-LOCH-JP-GMR.png',
  'File:GagagaGirlCellPhoneSubtraction-LOCH-JP-OP.png',
  'File:GagagaGirlCellPhoneSubtraction-LOCH-JP-PScR.png',
  'File:GagagaGirlCellPhoneSubtraction-LOCH-JP-ScR.png',
  'File:GagagaGirlCellPhoneSubtraction-LOCH-JP-UR-EA.png',
  'File:GagagaGirlCellPhoneSubtraction-LOCH-JP-UR.png',
  'File:GagagaGirlCellPhoneSubtraction-LOCH-KR-UR-UE-EA.png',
  'File:GagagaGirlCellPhoneSubtraction-LOCH-KR-UR-UE.png'
]
const ZOA = [
  'File:Zoa-YAC1-JP-ScR-MangaStyle-Color.png',
  'File:Zoa-YAC1-JP-ScR-MangaStyle-Monochrome.png',
  'File:Zoa-YAC1-JP-UR-MangaStyle-Monochrome.png',
  'File:Zoa-YAC1-JP-UR-MangaStyle-Color.png',
  'File:Zoa-YAC1-JP-UR.png'
]

describe('choosePrintingFile variants', () => {
  it('picks the extended-art (EA) file for an overframe, the plain one otherwise', () => {
    const p = { setCode: 'LOCH-JP012', language: 'ja' as const }
    expect(choosePrintingFile(GAGAGA, { ...p, rarity: 'Ultra Rare' })).toBe(
      'GagagaGirlCellPhoneSubtraction-LOCH-JP-UR.png'
    )
    expect(choosePrintingFile(GAGAGA, { ...p, rarity: 'Ultra Rare (Overframe)' })).toBe(
      'GagagaGirlCellPhoneSubtraction-LOCH-JP-UR-EA.png'
    )
    expect(choosePrintingFile(GAGAGA, { ...p, rarity: 'Ultra Rare', variant: 'Overframe' })).toBe(
      'GagagaGirlCellPhoneSubtraction-LOCH-JP-UR-EA.png'
    )
    expect(
      choosePrintingFile(GAGAGA, { ...p, rarity: 'Grand Master Rare', variant: 'Overframe' })
    ).toBe('GagagaGirlCellPhoneSubtraction-LOCH-JP-GMR.png')
    expect(
      choosePrintingFile(GAGAGA, {
        setCode: 'LOCH-KR012',
        language: 'ko',
        rarity: 'Ultra Rare (Overframe)'
      })
    ).toBe('GagagaGirlCellPhoneSubtraction-LOCH-KR-UR-UE-EA.png')
  })

  it('picks the Manga-Style colour file for a Manga-Style printing', () => {
    const p = { setCode: 'YAC1', language: 'ja' as const, variant: 'Manga-Style' }
    expect(choosePrintingFile(ZOA, { ...p, rarity: 'Ultra Rare' })).toBe(
      'Zoa-YAC1-JP-UR-MangaStyle-Color.png'
    )
    expect(choosePrintingFile(ZOA, { ...p, rarity: 'Secret Rare' })).toBe(
      'Zoa-YAC1-JP-ScR-MangaStyle-Color.png'
    )
  })

  it('picks the Color or Monochrome file for a Manga-Style printing of that tone', () => {
    const p = { setCode: 'YAC1', language: 'ja' as const }
    expect(
      choosePrintingFile(ZOA, { ...p, rarity: 'Ultra Rare', variant: 'Manga-Style, Color' })
    ).toBe('Zoa-YAC1-JP-UR-MangaStyle-Color.png')
    expect(choosePrintingFile(ZOA, { ...p, rarity: 'Ultra Rare (Manga-Style, Monochrome)' })).toBe(
      'Zoa-YAC1-JP-UR-MangaStyle-Monochrome.png'
    )
    expect(choosePrintingFile(ZOA, { ...p, rarity: 'Secret Rare (Manga-Style, Monochrome)' })).toBe(
      'Zoa-YAC1-JP-ScR-MangaStyle-Monochrome.png'
    )
    expect(
      choosePrintingFile(ZOA, { ...p, rarity: 'Secret Rare', variant: 'Manga-Style, Color' })
    ).toBe('Zoa-YAC1-JP-ScR-MangaStyle-Color.png')
  })
})

describe('fileShowsVariant', () => {
  const p = { setCode: 'LOCH-JP012', language: 'ja' as const }
  it("is true for a file named with the printing's variant, or a printing with none", () => {
    expect(
      fileShowsVariant('GagagaGirlCellPhoneSubtraction-LOCH-JP-UR-EA.png', {
        ...p,
        rarity: 'Ultra Rare (Overframe)'
      })
    ).toBe(true)
    expect(
      fileShowsVariant('Zoa-YAC1-JP-UR-MangaStyle-Color.png', {
        setCode: 'YAC1',
        language: 'ja',
        rarity: 'Ultra Rare',
        variant: 'Manga-Style'
      })
    ).toBe(true)
    expect(
      fileShowsVariant('GagagaGirlCellPhoneSubtraction-LOCH-JP-UR.png', {
        ...p,
        rarity: 'Ultra Rare'
      })
    ).toBe(true)
  })

  it("tells a Manga-Style printing's tone by its file", () => {
    const p = { setCode: 'YAC1', language: 'ja' as const }
    const color = { ...p, rarity: 'Ultra Rare', variant: 'Manga-Style, Color' }
    const mono = { ...p, rarity: 'Ultra Rare (Manga-Style, Monochrome)' }
    expect(fileShowsVariant('Zoa-YAC1-JP-UR-MangaStyle-Color.png', color)).toBe(true)
    expect(fileShowsVariant('Zoa-YAC1-JP-UR-MangaStyle-Monochrome.png', color)).toBe(false)
    expect(fileShowsVariant('Zoa-YAC1-JP-UR-MangaStyle-Monochrome.png', mono)).toBe(true)
    expect(fileShowsVariant('Zoa-YAC1-JP-UR-MangaStyle-Color.png', mono)).toBe(false)
  })

  it('is false for the plain file an overframe printing fell back to', () => {
    const overframe = { ...p, rarity: 'Grand Master Rare', variant: 'Overframe' }
    // Another rarity's file.
    expect(fileShowsVariant('GagagaGirlCellPhoneSubtraction-LOCH-JP-UR.png', overframe)).toBe(false)
    // Its own rarity's, when that rarity was printed plain too.
    expect(fileShowsVariant('GagagaGirlCellPhoneSubtraction-LOCH-JP-GMR.png', overframe)).toBe(
      false
    )
    expect(
      fileShowsVariant('Zoa-YAC1-JP-UR.png', {
        setCode: 'YAC1',
        language: 'ja',
        rarity: 'Ultra Rare',
        variant: 'Manga-Style'
      })
    ).toBe(false)
  })

  it("is true for its own rarity's plain-named file when that rarity was only printed so", () => {
    // LOCR's and YAC1's Prismatic Secret and Grand Master Rares are all overframe: PScR.png is.
    const overframe = { ...p, rarity: 'Grand Master Rare', variant: 'Overframe' }
    expect(
      fileShowsVariant('GagagaGirlCellPhoneSubtraction-LOCH-JP-GMR.png', overframe, true)
    ).toBe(true)
    expect(fileShowsVariant('GagagaGirlCellPhoneSubtraction-LOCH-JP-UR.png', overframe, true)).toBe(
      false
    )
    expect(
      fileShowsVariant('GagagaGirlCellPhoneSubtraction-LOCH-JP-GMR-UE.png', overframe, true)
    ).toBe(true)
  })

  it('is true for a New artwork printing, whose scans carry no suffix', () => {
    expect(
      fileShowsVariant('ShiEn-LOCR-JP-UR.png', {
        setCode: 'LOCR-JP032',
        language: 'ja',
        rarity: 'Ultra Rare',
        variant: 'New artwork'
      })
    ).toBe(true)
  })
})

describe('rarityAbbr', () => {
  it('maps names and stored codes', () => {
    expect(rarityAbbr('Secret Rare')).toBe('ScR')
    expect(rarityAbbr('Quarter Century Secret Rare')).toBe('QCScR')
    expect(rarityAbbr('Whatever', '(UtR)')).toBe('UtR')
    expect(rarityAbbr('Platinum Secret Rare', '(PS)')).toBe('PlScR')
    expect(rarityAbbr('Grand Master Rare')).toBe('GMR')
    expect(rarityAbbr('Unknown Shiny')).toBeNull()
  })

  it('takes a rarity stored as its own file-name abbreviation', () => {
    expect(rarityAbbr('PlScR')).toBe('PlScR')
    expect(rarityAbbr('QCScR')).toBe('QCScR')
  })
})

// Real Yugipedia gallery file names (asked for on 2026-11-02).
const PHARAOHS_SERVANT = [
  'DarkMagicianthePharaohsServant-LOCH-JP-GMR.png',
  'DarkMagicianthePharaohsServant-LOCH-JP-OP-EA.png',
  'DarkMagicianthePharaohsServant-LOCH-JP-OP.png',
  'DarkMagicianthePharaohsServant-LOCH-JP-PScR.png',
  'DarkMagicianthePharaohsServant-LOCH-JP-ScR.png',
  'DarkMagicianthePharaohsServant-LOCH-JP-UR-EA.png',
  'DarkMagicianthePharaohsServant-LOCH-JP-UR.png',
  'DarkMagicianthePharaohsServant-LOCH-KR-GMR-UE.png',
  'DarkMagicianthePharaohsServant-LOCH-KR-PScR-UE.png',
  'DarkMagicianthePharaohsServant-LOCH-KR-ScR-UE.png',
  'DarkMagicianthePharaohsServant-LOCH-KR-UR-UE-EA.png',
  'DarkMagicianthePharaohsServant-LOCH-KR-UR-UE.png',
  'DarkMagicianthePharaohsServant-LOCH-SC-PScR.png',
  'DarkMagicianthePharaohsServant-LOCH-SC-UR-EA.png',
  'DarkMagicianthePharaohsServant-LOCH-SC-UR.png',
  'DarkMagicianthePharaohsServant-MAMO-EN-GMR-1E.png',
  'DarkMagicianthePharaohsServant-MAMO-EN-StR-1E.png',
  'DarkMagicianthePharaohsServant-MAMO-EN-UE-OP.png',
  'DarkMagicianthePharaohsServant-MAMO-EN-UR-1E-EA.png',
  'DarkMagicianthePharaohsServant-MAMO-EN-UR-1E.png'
]
const KNIGHTMARE_UNICORN = [
  'KnightmareUnicorn-RA01-IT-UR-1E-AA.png',
  'KnightmareUnicorn-RA01-IT-UR-1E.png',
  'KnightmareUnicorn-RC04-JP-CR-AA.png',
  'KnightmareUnicorn-RC04-JP-CR.png',
  'KnightmareUnicorn-RC04-JP-UtR-AA.png',
  'KnightmareUnicorn-RC04-JP-UtR.png'
]
const AUSSA = [
  'FamiliarPossessedAussa-SD39-JP-ScR-AA.png',
  'FamiliarPossessedAussa-SD39-JP-ScR.png',
  'FamiliarPossessedAussa-SD39-KR-ScR-UE-AA.png',
  'FamiliarPossessedAussa-SD39-KR-ScR-UE.png'
]
const ALEISTER = [
  'AleistertheInvoker-RA04-DE-CR-1E.png',
  'AleistertheInvoker-RA04-DE-PlScR-1E-AA.png',
  'AleistertheInvoker-RA04-DE-PlScR-1E.png',
  'AleistertheInvoker-RA04-DE-QCScR-1E-AA.png',
  'AleistertheInvoker-RA04-DE-QCScR-1E.png'
]

describe('choosePrintingScan', () => {
  it('takes the overframe scan in OCG languages; an unsuffixed one only when its rarity is all overframe', () => {
    const scan = (
      setCode: string,
      language: 'ja' | 'ko' | 'zh-hans',
      rarity: string,
      variant?: string,
      only = false
    ): string | null =>
      choosePrintingScan(PHARAOHS_SERVANT, { setCode, language, rarity, variant }, only)
    expect(scan('LOCH-KR001', 'ko', 'Ultra Rare (Overframe)')).toBe(
      'DarkMagicianthePharaohsServant-LOCH-KR-UR-UE-EA.png'
    )
    expect(scan('LOCH-JP001', 'ja', 'Ultra Rare (Overframe)')).toBe(
      'DarkMagicianthePharaohsServant-LOCH-JP-UR-EA.png'
    )
    expect(scan('LOCH-SC001', 'zh-hans', 'Ultra Rare', 'Overframe')).toBe(
      'DarkMagicianthePharaohsServant-LOCH-SC-UR-EA.png'
    )
    // LOCH's Prismatic Secret and Grand Master Rares are all overframe, filed with no suffix.
    expect(scan('LOCH-KR001', 'ko', 'Prismatic Secret Rare', 'Overframe', true)).toBe(
      'DarkMagicianthePharaohsServant-LOCH-KR-PScR-UE.png'
    )
    expect(scan('LOCH-KR001', 'ko', 'Grand Master Rare', 'Overframe', true)).toBe(
      'DarkMagicianthePharaohsServant-LOCH-KR-GMR-UE.png'
    )
    // Were a plain Prismatic Secret Rare printed too, its scan would not be the overframe's.
    expect(scan('LOCH-KR001', 'ko', 'Prismatic Secret Rare', 'Overframe')).toBeNull()
  })

  it('takes the overframe scan of an English printing', () => {
    expect(
      choosePrintingScan(PHARAOHS_SERVANT, {
        setCode: 'MAMO-EN001',
        language: 'en',
        rarity: 'Ultra Rare (Overframe)'
      })
    ).toBe('DarkMagicianthePharaohsServant-MAMO-EN-UR-1E-EA.png')
    expect(
      choosePrintingScan(
        PHARAOHS_SERVANT,
        { setCode: 'MAMO-EN001', language: 'en', rarity: 'Starlight Rare', variant: 'Overframe' },
        true
      )
    ).toBe('DarkMagicianthePharaohsServant-MAMO-EN-StR-1E.png')
  })

  it("takes an overframe from its rarity's scan when Yugipedia names no variant (RV01)", () => {
    const files = [
      'BlueEyesToonDragon-RV01-JP-C.png',
      'BlueEyesToonDragon-RV01-JP-OP.png',
      'BlueEyesToonDragon-RV01-JP-ScR.png'
    ]
    const p = {
      setCode: 'RV01-JP008',
      language: 'ja' as const,
      rarity: 'Secret Rare',
      variant: 'Overframe'
    }
    expect(choosePrintingScan(files, p, true)).toBe('BlueEyesToonDragon-RV01-JP-ScR.png')
  })

  it("takes a chibi printing's scan when its code was only printed chibi (BLGG), else none", () => {
    const files = [
      'SummonedSkull-BLGG-DE-ScR-1E.png',
      'SummonedSkull-BLGG-DE-StR-1E.png',
      'SummonedSkull-BLGG-EN-StR-1E.png'
    ]
    const p = {
      setCode: 'BLGG-DE001',
      language: 'de' as const,
      rarity: 'Starlight Rare',
      variant: 'Chibi artwork'
    }
    expect(choosePrintingScan(files, p, true)).toBe('SummonedSkull-BLGG-DE-StR-1E.png')
    expect(choosePrintingScan(files, p, false)).toBeNull()
  })

  it('takes the alternate-art (AA) scan, in either spelling of the variant', () => {
    expect(
      choosePrintingScan(KNIGHTMARE_UNICORN, {
        setCode: 'RA01-IT043',
        language: 'it',
        rarity: 'Ultra Rare (Alternate Art)'
      })
    ).toBe('KnightmareUnicorn-RA01-IT-UR-1E-AA.png')
    expect(
      choosePrintingScan(KNIGHTMARE_UNICORN, {
        setCode: 'RC04-JP044',
        language: 'ja',
        rarity: "Collector's Rare (Alternate Art)"
      })
    ).toBe('KnightmareUnicorn-RC04-JP-CR-AA.png')
    expect(
      choosePrintingScan(AUSSA, {
        setCode: 'SD39-KRP01',
        language: 'ko',
        rarity: 'Secret Rare (Alternate Art)'
      })
    ).toBe('FamiliarPossessedAussa-SD39-KR-ScR-UE-AA.png')
    expect(
      choosePrintingScan(['HouseDragonmaid-WT01-SC-UR-AA.png', 'HouseDragonmaid-WT01-SC-UR.png'], {
        setCode: 'WT01-SC011',
        language: 'zh-hans',
        rarity: 'Ultra Rare (Alternate artwork)'
      })
    ).toBe('HouseDragonmaid-WT01-SC-UR-AA.png')
    // The plain printing keeps the plain scan.
    expect(
      choosePrintingScan(AUSSA, { setCode: 'SD39-JPP01', language: 'ja', rarity: 'Secret Rare' })
    ).toBe('FamiliarPossessedAussa-SD39-JP-ScR.png')
  })

  it('reads a rarity stored as its abbreviation (PlScR)', () => {
    const p = { setCode: 'RA04-DE024', language: 'de' as const }
    expect(choosePrintingScan(ALEISTER, { ...p, rarity: 'PlScR' })).toBe(
      'AleistertheInvoker-RA04-DE-PlScR-1E.png'
    )
    expect(
      choosePrintingScan(ALEISTER, { ...p, rarity: 'PlScR', variant: 'Alternate artwork' })
    ).toBe('AleistertheInvoker-RA04-DE-PlScR-1E-AA.png')
    expect(choosePrintingScan(ALEISTER, { ...p, rarity: 'PlScR (Alternate Art)' })).toBe(
      'AleistertheInvoker-RA04-DE-PlScR-1E-AA.png'
    )
  })

  it("never takes a plain scan for an art the gallery doesn't name: none over the wrong art", () => {
    // LART-DE015's Japanese-artwork Ultra Rare; the one scan is of one of its two Ultra Rares.
    expect(
      choosePrintingScan(['EdgeImpSabres-LART-DE-UR-LE.png'], {
        setCode: 'LART-DE015',
        language: 'de',
        rarity: 'Ultra Rare',
        variant: 'Japanese artwork'
      })
    ).toBeNull()
    // RA04's 7th and 8th Blue-Eyes arts, both scanned with numbered suffixes: no telling which.
    expect(
      choosePrintingScan(
        [
          'BlueEyesWhiteDragon-RA04-DE-PlScR-1E-AA.png',
          'BlueEyesWhiteDragon-RA04-DE-PlScR-1E-AA2.png'
        ],
        { setCode: 'RA04-DE108', language: 'de', rarity: 'PlScR (7th artwork)' },
        true
      )
    ).toBeNull()
    // An alternate art with only plain and numbered scans.
    expect(
      choosePrintingScan(
        [
          'BlueEyesWhiteDragon-LDK2-FR-C-1E-2.png',
          'BlueEyesWhiteDragon-LDK2-FR-C-1E-3.png',
          'BlueEyesWhiteDragon-LDK2-FR-C-1E.png'
        ],
        { setCode: 'LDK2-FRK01', language: 'fr', rarity: 'Common (Alternate Art)' }
      )
    ).toBeNull()
    // An overframe whose own scan isn't up yet.
    expect(
      choosePrintingScan(['BlueEyesWhiteDragontheWhitePhantomBeast-MAMS-EN-UR-1E.png'], {
        setCode: 'MAMS-EN001',
        language: 'en',
        rarity: 'Ultra Rare (Overframe)'
      })
    ).toBeNull()
  })

  it("takes the plain scan for a variant of the usual art's foil, not of its art", () => {
    expect(
      choosePrintingScan(['Division-24PP-JP-C.png', 'Division-24PP-JP-ScR.png'], {
        setCode: '24PP-JP005',
        language: 'ja',
        rarity: 'Secret Rare (Special Red Version)'
      })
    ).toBe('Division-24PP-JP-ScR.png')
    expect(
      choosePrintingScan(['ACaseforK9-26LP-EN-UR-1E.png'], {
        setCode: '26LP-EN011',
        language: 'en',
        rarity: 'Ultra Rare (Emblazoned)'
      })
    ).toBe('ACaseforK9-26LP-EN-UR-1E.png')
  })

  it("takes a New artwork printing's unsuffixed scan", () => {
    expect(
      choosePrintingScan(['ShiEn-LOCR-JP-UR.png'], {
        setCode: 'LOCR-JP032',
        language: 'ja',
        rarity: 'Ultra Rare',
        variant: 'New artwork'
      })
    ).toBe('ShiEn-LOCR-JP-UR.png')
  })
})

describe('printingPhotoSuffix', () => {
  it('re-keys the photos of printings whose scan choice changed (art variants, abbreviated rarities)', () => {
    expect(printingPhotoSuffix({ rarity: 'Ultra Rare' })).toBe('')
    expect(printingPhotoSuffix({ rarity: 'Ultra Rare', variant: null })).toBe('')
    expect(printingPhotoSuffix({ rarity: 'Ultra Rare (Alternate Art)' })).toBe('-v38')
    expect(printingPhotoSuffix({ rarity: 'Starlight Rare', variant: 'Chibi artwork' })).toBe('-v38')
    expect(printingPhotoSuffix({ rarity: 'PlScR' })).toBe('-v38')
  })
})

describe('needsOwnScan', () => {
  it('is true for art variants; false for plain printings, new art and foil-only variants', () => {
    expect(needsOwnScan({ rarity: 'Ultra Rare (Overframe)' })).toBe(true)
    expect(needsOwnScan({ rarity: 'Starlight Rare', variant: 'Chibi artwork' })).toBe(true)
    expect(needsOwnScan({ rarity: 'PlScR (7th artwork)' })).toBe(true)
    expect(needsOwnScan({ rarity: 'Ultra Rare' })).toBe(false)
    expect(needsOwnScan({ rarity: 'Ultra Rare', variant: 'New artwork' })).toBe(false)
    expect(needsOwnScan({ rarity: 'Secret Rare (Special Red Version)' })).toBe(false)
    expect(needsOwnScan({ rarity: 'Ultra Rare (25th Anniversary Edition)' })).toBe(false)
    expect(needsOwnScan({ rarity: 'Ultra Rare (Blue)' })).toBe(false)
  })
})
