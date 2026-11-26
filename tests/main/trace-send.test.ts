import { describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTraceSender, type TraceClient } from '../../src/main/scan/traceSend'
import type { TraceSendState } from '../../src/shared/traces'

const S1 = '2026-11-25T10-00-00-000Z'
const S2 = '2026-11-25T11-00-00-000Z'
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 1])

function traceDir(sessions: Record<string, string[]>): string {
  const root = mkdtempSync(join(tmpdir(), 'trace-send-'))
  for (const [session, frames] of Object.entries(sessions)) {
    mkdirSync(join(root, session))
    writeFileSync(join(root, session, 'trace.jsonl'), '{"game":"pkm","seq":1}\n{"seq":2}\n')
    for (const f of frames) writeFileSync(join(root, session, f), JPEG)
  }
  return root
}

function fakeClient(over: Partial<TraceClient> = {}): TraceClient & { files: string[] } {
  const files: string[] = []
  return {
    files,
    traceStart: vi.fn(async () => ({ id: 7, token: 'tok' })),
    traceFile: vi.fn(async (_id: number, name: string) => {
      files.push(name)
    }),
    traceDone: vi.fn(async () => ({})),
    ...over
  }
}

async function settle(sender: { state(): TraceSendState }): Promise<TraceSendState> {
  for (let i = 0; i < 200 && sender.state().kind === 'sending'; i++)
    await new Promise((r) => setTimeout(r, 5))
  return sender.state()
}

const senderFor = (root: string, client: TraceClient, latest = S2) =>
  createTraceSender({
    root,
    latest: async () => latest,
    appVersion: '0.122.0',
    asAccount: (call) => call(client),
    isSignedOut: (e) => e instanceof Error && e.message === 'signed out'
  })

describe('trace sender', () => {
  it('sends the newest session: every frame, then the log, then done', async () => {
    const root = traceDir({ [S1]: ['0000.jpg'], [S2]: ['0002.jpg', '0010.jpg', '0003.jpg'] })
    const client = fakeClient()
    const sender = senderFor(root, client)
    expect(sender.send('Missed a Secret Rare').kind).toBe('sending')
    expect(await settle(sender)).toEqual({ kind: 'sent', id: 7, files: 4 })
    expect(client.traceStart).toHaveBeenCalledWith({
      game: 'pkm',
      session: S2,
      note: 'Missed a Secret Rare',
      appVersion: '0.122.0'
    })
    expect(client.files.slice(0, 3).sort()).toEqual(['0002.jpg', '0003.jpg', '0010.jpg'])
    expect(client.files.at(-1)).toBe('trace.jsonl')
    expect(client.traceDone).toHaveBeenCalledWith(7)
  })

  it('says there is no trace when no session was recorded', async () => {
    const sender = createTraceSender({
      root: traceDir({}),
      latest: async () => null,
      appVersion: '1',
      asAccount: (call) => call(fakeClient()),
      isSignedOut: () => false
    })
    sender.send('')
    expect(await settle(sender)).toEqual({ kind: 'failed', reason: 'no-trace' })
  })

  it('tells a daily cap, a sign-out and a lost connection apart', async () => {
    const root = traceDir({ [S2]: ['0000.jpg'] })
    const cases: [Error, string][] = [
      [new Error('daily-cap'), 'daily-cap'],
      [new Error('signed out'), 'signed-out'],
      [new Error('Could not reach'), 'offline']
    ]
    for (const [error, reason] of cases) {
      const sender = senderFor(
        root,
        fakeClient({
          traceStart: async () => {
            throw error
          }
        })
      )
      sender.send('')
      expect(await settle(sender)).toEqual({ kind: 'failed', reason })
    }
  })

  it('a second send while one is going leaves it be', async () => {
    const root = traceDir({ [S2]: ['0000.jpg'] })
    const client = fakeClient()
    const sender = senderFor(root, client)
    sender.send('one')
    sender.send('two')
    await settle(sender)
    expect(client.traceStart).toHaveBeenCalledTimes(1)
  })
})
