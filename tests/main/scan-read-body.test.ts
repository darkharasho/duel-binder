import { describe, expect, it } from 'vitest'
import { readBody } from '../../src/shared/scan/readBody'

const stream = (...chunks: number[][]): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(c) {
      chunks.forEach((chunk) => c.enqueue(new Uint8Array(chunk)))
      c.close()
    }
  })

describe('readBody', () => {
  it('reports the share arrived and keeps every byte', async () => {
    const shares: number[] = []
    const res = new Response(stream([1, 2], [3, 4]), { headers: { 'Content-Length': '4' } })
    expect([...(await readBody(res, (s) => shares.push(s)))]).toEqual([1, 2, 3, 4])
    expect(shares).toEqual([0.5, 1])
  })

  it('reports nothing with no size', async () => {
    const shares: number[] = []
    expect([...(await readBody(new Response(stream([1])), (s) => shares.push(s)))]).toEqual([1])
    expect(shares).toEqual([])
  })

  it('reads a body longer than its stated size in full, without passing 100%', async () => {
    const shares: number[] = []
    const res = new Response(stream([1, 2], [3]), { headers: { 'Content-Length': '2' } })
    expect([...(await readBody(res, (s) => shares.push(s)))]).toEqual([1, 2, 3])
    expect(shares).toEqual([1])
  })
})
