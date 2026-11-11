import { describe, expect, it } from 'vitest'
import { applyReverseCheck } from '@/features/scan/reverseCheck'
import type { VersionCues } from '@/features/scan/vision/pokemonVersion'
import type { BodyStats } from '@shared/scan/reverseHolo'
import type { ScanDraft } from '@shared/scan/types'
import { printing } from './scanFakes'

const REF: BodyStats = { ratio: 1, spread: 0.1 }
const cues = (body: BodyStats): VersionCues => ({
  frame: 0,
  art: 0,
  reference: 0,
  firstEdition: 'unknown',
  body
})
const READS_REVERSE = cues({ ratio: 0.5, spread: 0.1 })
const READS_NORMAL = cues({ ratio: 1, spread: 0.1 })
const refs = (): BodyStats | null => REF

const opt = (printingId: number, rarity: string, extra = {}) =>
  printing({
    printingId,
    cardId: 1,
    name: 'Eevee',
    frameType: 'pokemon',
    setCode: 'DLR 002/103',
    rarity,
    language: 'en',
    imageIds: [401],
    ...extra
  })

const draftOf = (options = [opt(1, 'Normal'), opt(2, 'Reverse Holofoil')]): ScanDraft => ({
  cardId: 1,
  name: 'Eevee',
  imageId: 401,
  printingId: options[0].printingId,
  setCode: options[0].setCode,
  rarity: options[0].rarity,
  options,
  flag: 'check-rarity',
  via: 'art',
  game: 'pkm'
})

describe('applyReverseCheck', () => {
  it('names the Reverse Holofoil printing when the body reads as reverse', () => {
    expect(applyReverseCheck(draftOf(), READS_REVERSE, refs)).toMatchObject({
      printingId: 2,
      rarity: 'Reverse Holofoil',
      setCode: 'DLR 002/103',
      flag: null
    })
  })

  it('names the Normal printing when the body reads as normal', () => {
    expect(applyReverseCheck(draftOf(), READS_NORMAL, refs)).toMatchObject({
      printingId: 1,
      rarity: 'Normal',
      flag: null
    })
  })

  it('leaves the draft alone when the check does not apply', () => {
    const item = draftOf()
    expect(applyReverseCheck(item, READS_REVERSE, undefined)).toBe(item)
    expect(applyReverseCheck(item, null, refs)).toBe(item)
    expect(applyReverseCheck(item, undefined, refs)).toBe(item)
    expect(applyReverseCheck(item, READS_REVERSE, () => null)).toBe(item)
    const ja = draftOf([opt(1, 'Normal', { language: 'ja' }), opt(2, 'Reverse Holofoil')])
    expect(applyReverseCheck(ja, READS_REVERSE, refs)).toBe(ja)
    const dri = draftOf([
      opt(1, 'Normal', { setCode: 'DRI 001/182' }),
      opt(2, 'Reverse Holofoil', { setCode: 'DRI 001/182' })
    ])
    expect(applyReverseCheck(dri, READS_REVERSE, refs)).toBe(dri)
    const three = draftOf([opt(1, 'Normal'), opt(2, 'Reverse Holofoil'), opt(3, 'Holofoil')])
    expect(applyReverseCheck(three, READS_REVERSE, refs)).toBe(three)
  })
})
