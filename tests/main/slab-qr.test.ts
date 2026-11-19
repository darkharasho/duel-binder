import { parseSlabQr, slabReportUrl } from '../../src/shared/scan/slabQr'

describe('parseSlabQr', () => {
  it('reads a TAG slab link in each form TAG uses', () => {
    expect(parseSlabQr('https://tagd.co/Y1267951')).toEqual({ company: 'TAG', cert: 'Y1267951' })
    expect(parseSlabQr('tagd.co/y1267951')).toEqual({ company: 'TAG', cert: 'Y1267951' })
    expect(parseSlabQr('https://my.taggrading.com/card/Y1267951')).toEqual({
      company: 'TAG',
      cert: 'Y1267951'
    })
  })

  it('reads other graders’ cert links', () => {
    expect(parseSlabQr('https://www.psacard.com/cert/84512277/psa')).toEqual({
      company: 'PSA',
      cert: '84512277'
    })
    expect(parseSlabQr('https://www.cgccards.com/certlookup/4123456001/')).toEqual({
      company: 'CGC',
      cert: '4123456001'
    })
    expect(
      parseSlabQr('https://www.beckett.com/grading/card-lookup?item_type=BGS&item_id=0012345678')
    ).toEqual({ company: 'BGS', cert: '0012345678' })
  })

  it('passes over links that aren’t a grader’s, or hold no cert', () => {
    expect(parseSlabQr('https://example.com/cert/12345678')).toBeNull()
    expect(parseSlabQr('https://evil-tagd.co.example.com/Y1267951')).toBeNull()
    expect(parseSlabQr('https://www.psacard.com/pop')).toBeNull()
    expect(parseSlabQr('just some text')).toBeNull()
    expect(parseSlabQr('')).toBeNull()
  })
})

describe('slabReportUrl', () => {
  it('links the graders whose public report page we know', () => {
    expect(slabReportUrl('TAG', 'Y1267951')).toBe('https://tagd.co/Y1267951')
    expect(slabReportUrl('PSA', ' 84512277 ')).toBe('https://www.psacard.com/cert/84512277')
    expect(slabReportUrl('CGC', '4123456001')).toBe(
      'https://www.cgccards.com/certlookup/4123456001/'
    )
  })

  it('links nothing for other graders or a cert that isn’t one', () => {
    expect(slabReportUrl('SGC', '12345678')).toBeNull()
    expect(slabReportUrl('PSA', '')).toBeNull()
    expect(slabReportUrl('PSA', '12/../x')).toBeNull()
  })
})
