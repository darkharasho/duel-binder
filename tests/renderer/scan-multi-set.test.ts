import { describe, expect, it } from 'vitest'
import { parseSets } from '@/features/scan/ScanHub'
import { scanSetInputs } from '@/features/scan/setPrintings'
import { resolutionText } from '@shared/scanWindow'
import { printing } from './scanFakes'

const MRD = { setName: 'Metal Raiders', language: 'en' as const }
const LOB = { setName: 'Legend of Blue Eyes White Dragon', language: 'en' as const }

describe('the saved sets', () => {
  it('takes a set saved before several could be picked as a list of one', () => {
    expect(parseSets(JSON.stringify(MRD))).toEqual([MRD])
  })

  it('reads a saved list, dropping what it cannot read and a set listed twice', () => {
    expect(parseSets(JSON.stringify([MRD, LOB]))).toEqual([MRD, LOB])
    expect(
      parseSets(JSON.stringify([MRD, { setName: 'x', language: 'klingon' }, 7, null, MRD]))
    ).toEqual([MRD])
    expect(parseSets(JSON.stringify({ setName: 3 }))).toEqual([])
    expect(parseSets('null')).toEqual([])
  })
})

describe('the picked sets joined for the scan', () => {
  const mrd = [printing({ printingId: 1, imageIds: [10, 11] })]
  const lob = [
    printing({ printingId: 2, cardId: 2, imageIds: [20] }),
    // The same printing twice (a set listed under two names, say) is listed once.
    printing({ printingId: 1, imageIds: [10, 11] })
  ]
  const ok = (data: ReturnType<typeof printing>[]) => ({ data, isError: false })
  const failed = { data: undefined, isError: true }
  const loading = { data: undefined, isError: false }

  it('is any set with none picked', () => {
    expect(scanSetInputs([], [])).toEqual({
      setKey: 'any',
      setPrintings: null,
      setUnreadable: false,
      setsSkipped: []
    })
  })

  it("unions every set's printings, each once", () => {
    const { setPrintings } = scanSetInputs([MRD, LOB], [ok(mrd), ok(lob)])
    expect(setPrintings?.map((p) => p.printingId)).toEqual([1, 2])
  })

  it('keys the scan by the sets, whatever order they were picked in', () => {
    const a = scanSetInputs([MRD, LOB], [ok(mrd), ok(lob)]).setKey
    const b = scanSetInputs([LOB, MRD], [ok(lob), ok(mrd)]).setKey
    expect(a).toBe(b)
    expect(a).not.toBe(scanSetInputs([MRD], [ok(mrd)]).setKey)
  })

  it('waits while any set is still loading', () => {
    expect(scanSetInputs([MRD, LOB], [ok(mrd), loading]).setPrintings).toBeUndefined()
  })

  it("skips a set whose printings can't be read, and scans the rest", () => {
    const out = scanSetInputs([MRD, LOB], [failed, ok(lob)])
    expect(out.setPrintings?.map((p) => p.printingId)).toEqual([2, 1])
    expect(out.setsSkipped).toEqual([MRD])
    expect(out.setUnreadable).toBe(false)
    expect(out.setKey).toBe(scanSetInputs([LOB], [ok(lob)]).setKey)
  })

  it('scans as any set only when no picked set can be read', () => {
    expect(scanSetInputs([MRD, LOB], [failed, failed])).toEqual({
      setKey: 'any',
      setPrintings: null,
      setUnreadable: true,
      setsSkipped: []
    })
  })
})

describe('the camera resolution', () => {
  it('reads as size and frame rate', () => {
    expect(resolutionText({ width: 3840, height: 2160, frameRate: 30 })).toBe('3840×2160 · 30 fps')
    expect(resolutionText({ width: 1920, height: 1080, frameRate: 29.97 })).toBe(
      '1920×1080 · 30 fps'
    )
    expect(resolutionText({ width: 1280, height: 720, frameRate: null })).toBe('1280×720')
  })
})
