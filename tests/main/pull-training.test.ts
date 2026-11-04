import { describe, expect, test } from 'vitest'
import type { TrainingLabelRow } from '../../src/shared/training'
import { planPull } from '../../scripts/scan/pull-training'

const A = '0f8e2c1a-1b2c-4d3e-8f90-00000000000a'
const B = A.replace(/a$/, 'b')
const C = A.replace(/a$/, 'c')
const row = (id: number, clientId: string): TrainingLabelRow => ({
  id, clientId, game: 'op', userId: 7, username: 'dubgrumble', cardId: 2 ** 39 + 5,
  printingId: 812, holder: 'bare', device: 'Android 15 Pixel 8', appVersion: '0.53.0',
  takenAt: '2026-11-05T01:59:00.000Z', createdAt: '2026-11-05T01:59:01.000Z', language: 'en',
  number: 'OP05-119', bandaiId: null, version: 'SR'
})

describe('planPull', () => {
  test('plans only missing photos and keeps id order', () => {
    const p = planPull([row(1, A), row(2, B), row(3, C)], new Set([`${B}.jpg`, 'z.jpg']))
    expect(p.download.map((r) => r.clientId)).toEqual([A, C])
    expect(p.truth.map((t) => t.file)).toEqual([`shots-op/${A}.jpg`, `shots-op/${B}.jpg`, `shots-op/${C}.jpg`])
    expect(p.stale).toEqual(['z.jpg'])
  })
  test('truth rows have the pkm-truth keys', () => {
    const t = planPull([row(1, A)], new Set()).truth[0]
    for (const k of ['file', 'source', 'sourceId', 'version', 'language', 'holder']) expect(t).toHaveProperty(k)
  })
  test("a client id that isn't a UUID never names a file", () => {
    const p = planPull([row(1, '../../x'), row(2, A)], new Set())
    expect(p.download.map((r) => r.clientId)).toEqual([A])
    expect(p.truth.map((t) => t.file)).toEqual([`shots-op/${A}.jpg`])
  })
})
