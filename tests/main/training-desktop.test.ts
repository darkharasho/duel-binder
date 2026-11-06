import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() }, clipboard: {} }))

import { createCloudClient } from '../../src/main/cloud/client'
import { checkTrainingUpload } from '../../src/main/ipc/handlers'
import {
  MAX_TRAINING_PHOTO_BYTES,
  type TrainingLabel,
  type TrainingSend
} from '../../src/shared/training'

const NOW = new Date('2026-11-05T12:00:00.000Z')
const ID = '0b6c1d7e-3f4a-4b5c-8d9e-0f1a2b3c4d5e'
const LABEL: TrainingLabel = {
  game: 'op',
  cardId: 2 ** 39 + 5,
  printingId: 9004,
  holder: 'sleeve',
  device: 'Linux x86_64',
  appVersion: '0.59.0',
  takenAt: NOW.toISOString()
}
const JPEG = new Uint8Array([0xff, 0xd8, 0xff]).buffer

describe('checkTrainingUpload', () => {
  it('passes a photo the portal would take', () => {
    expect(checkTrainingUpload(ID, LABEL, JPEG, NOW)).toEqual({
      clientId: ID,
      label: LABEL,
      jpeg: JPEG
    })
    // Bytes may arrive as a Uint8Array view.
    expect(checkTrainingUpload(ID, LABEL, new Uint8Array(JPEG), NOW)?.jpeg.byteLength).toBe(3)
  })

  it('refuses bad ids, labels and sizes', () => {
    expect(checkTrainingUpload('nope', LABEL, JPEG, NOW)).toBeNull()
    expect(checkTrainingUpload(ID, { ...LABEL, holder: 'binder' }, JPEG, NOW)).toBeNull()
    expect(checkTrainingUpload(ID, { ...LABEL, game: 'mtg' }, JPEG, NOW)).toBeNull()
    expect(checkTrainingUpload(ID, null, JPEG, NOW)).toBeNull()
    expect(checkTrainingUpload(ID, LABEL, new ArrayBuffer(0), NOW)).toBeNull()
    expect(
      checkTrainingUpload(ID, LABEL, new ArrayBuffer(MAX_TRAINING_PHOTO_BYTES + 1), NOW)
    ).toBeNull()
    expect(checkTrainingUpload(ID, LABEL, 'jpeg', NOW)).toBeNull()
  })
})

describe('desktop training calls', () => {
  const clientWith = (
    res: () => Response | Promise<Response>
  ): { fetch: ReturnType<typeof vi.fn>; client: ReturnType<typeof createCloudClient> } => {
    const fetch = vi.fn(async () => res())
    return {
      fetch,
      client: createCloudClient({
        baseUrl: 'https://portal.test/',
        token: 'tok',
        fetch: fetch as unknown as typeof globalThis.fetch
      })
    }
  }

  it('uploads with the label in the query and the bearer token', async () => {
    const { fetch, client } = clientWith(() => Response.json({ total: 3, today: 2, dailyCap: 500 }))
    expect(await client.trainingUpload(ID, LABEL, JPEG)).toEqual({
      ok: true,
      summary: { total: 3, today: 2, dailyCap: 500 }
    })
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toMatch(`https://portal.test/api/training/photos/${ID}?`)
    expect(new URL(url).searchParams.get('holder')).toBe('sleeve')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({
      authorization: 'Bearer tok',
      'content-type': 'image/jpeg'
    })
    expect(init.body).toBe(JPEG)
  })

  it('reads the portal answers the way the phone does', async () => {
    const answer = async (status: number): Promise<TrainingSend> =>
      clientWith(() => new Response(null, { status })).client.trainingDelete(ID)
    expect(await answer(204)).toEqual({ ok: true, summary: null })
    expect(await answer(429)).toEqual({ ok: false, retry: true, reason: 'daily-cap' })
    expect(await answer(413)).toEqual({ ok: false, retry: false, reason: 'too-big' })
    expect(await answer(400)).toEqual({ ok: false, retry: false, reason: 'rejected' })
    expect(await answer(503)).toEqual({ ok: false, retry: true, reason: 'offline' })
    expect(await answer(401)).toEqual({ ok: false, retry: true, reason: 'signed-out' })
    const down = clientWith(() => Promise.reject(new TypeError('fetch failed'))).client
    expect(await down.trainingSummary('op')).toEqual({ ok: false, retry: true, reason: 'offline' })
  })
})
