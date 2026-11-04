import { describe, expect, test } from 'vitest'
import {
  HOLDER_LABELS, TRAINING_HOLDERS, labelParams, readLabel, trainingKey, truthRowOf,
  type TrainingLabel, type TrainingLabelRow
} from '../../src/shared/training'

const row: TrainingLabelRow = { id: 1, clientId: '0f8e2c1a-1b2c-4d3e-8f90-123456789abc', game: 'op',
  userId: 7, username: 'dubgrumble', cardId: 2 ** 39 + 5, printingId: 812, holder: 'bare',
  device: 'Android 15 Pixel 8', appVersion: '0.53.0', takenAt: '2026-11-05T01:59:00.000Z',
  createdAt: '2026-11-05T01:59:01.000Z', language: 'en', number: 'OP05-119', bandaiId: '',
  version: 'SR' }
const NOW = new Date('2026-11-05T02:00:00.000Z')
const label: TrainingLabel = { game: 'op', cardId: 2 ** 39 + 5, printingId: 812, holder: 'sleeve',
  device: 'Android 15 Pixel 8', appVersion: '0.53.0', takenAt: '2026-11-05T01:59:00.000Z' }

describe('training shared', () => {
  test('label round-trips through its params', () => {
    expect(readLabel(labelParams(label), NOW)).toEqual(label)
  })
  test.each([
    ['holder', 'binder'], ['card', '0'], ['printing', '1.5'], ['game', 'mtg'], ['app', 'v1'],
    ['device', ''], ['device', 'x'.repeat(101)], ['device', 'a\u0007b'],
    ['at', '2026-10-05T00:00:00.000Z'], ['at', '2026-11-06T03:00:00.000Z'], ['at', 'yesterday']
  ])('bad %s %j is refused', (k, v) => {
    const q = labelParams(label); q.set(k, v)
    expect(readLabel(q, NOW)).toBeNull()
  })
  test('key', () => {
    expect(trainingKey('op', 7, '0f8e2c1a-1b2c-4d3e-8f90-123456789abc'))
      .toBe('training/op/7/0f8e2c1a-1b2c-4d3e-8f90-123456789abc.jpg')
  })
  test('truth row is card-level with the Bandai id kept', () => {
    expect(truthRowOf({ ...row, language: 'en', number: 'OP05-119', bandaiId: 'OP05-119_p1',
      version: 'SR (Alternate Art)', holder: 'toploader', username: 'dubgrumble' })).toMatchObject({
      file: `shots-op/${row.clientId}.jpg`, source: 'app', sourceId: 'en/OP05-119',
      version: 'SR (Alternate Art)', language: 'en', holder: 'toploader', bandaiId: 'OP05-119_p1',
      tester: 'dubgrumble' })
  })
  test('a missing printing gives a null sourceId', () => {
    expect(truthRowOf({ ...row, language: null, number: null, bandaiId: '', version: null }))
      .toMatchObject({ sourceId: null, bandaiId: null, version: null })
  })
  test('holder labels', () => {
    expect(TRAINING_HOLDERS.map((h) => HOLDER_LABELS[h]))
      .toEqual(['Bare', 'Sleeve', 'Top loader', 'Magnetic case', 'Slab'])
  })
})
