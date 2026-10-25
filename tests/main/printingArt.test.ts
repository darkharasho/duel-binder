import { describe, expect, it } from 'vitest'
import { choosePrintingFile, rarityAbbr } from '../../src/main/yugipedia/printingArt'

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
      choosePrintingFile(BEWD, { setCode: 'SDK-001', language: 'en', rarity: 'Common', rarityCode: '(C)' })
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
})
