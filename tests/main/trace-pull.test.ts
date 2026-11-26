import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pullTrace, pulledTraceDir } from '../../src/main/scan/tracePull'
import type { AdminTrace } from '../../src/shared/traces'

const TRACE: AdminTrace = {
  id: 12,
  userId: 2,
  username: 'kai.ba',
  game: 'pkm',
  session: '2026-11-25T10-00-00-000Z',
  note: 'Missed a reverse holo',
  appVersion: '0.122.0',
  files: 3,
  bytes: 10,
  createdAt: '2026-11-25T10:30:00.000Z',
  doneAt: '2026-11-25T10:31:00.000Z'
}

const enc = (s: string): ArrayBuffer => new TextEncoder().encode(s).buffer as ArrayBuffer

describe('pulling a donated trace', () => {
  it("puts its files beside the owner's traces, under a name the writer never prunes", async () => {
    const root = mkdtempSync(join(tmpdir(), 'pull-'))
    const asked: string[] = []
    const files: Record<string, string> = {
      '/admin/traces/12/files': JSON.stringify({
        files: [
          { name: 'trace.jsonl', size: 4 },
          { name: '0003.jpg', size: 1 },
          { name: '../evil.jpg', size: 1 }
        ]
      }),
      '/admin/traces/12/files/trace.jsonl': '{}\n',
      '/admin/traces/12/files/0003.jpg': 'J'
    }
    const dir = await pullTrace(TRACE, root, async (path) => {
      asked.push(path)
      return enc(files[path]!)
    })
    expect(dir).toBe(join(root, '2026-11-25T10-00-00-000Z_t12-kaiba'))
    expect(pulledTraceDir(TRACE)).toBe('2026-11-25T10-00-00-000Z_t12-kaiba')
    expect(readdirSync(dir).sort()).toEqual(['0003.jpg', 'donated.json', 'trace.jsonl'])
    expect(asked).not.toContain('/admin/traces/12/files/../evil.jpg')
    expect(JSON.parse(readFileSync(join(dir, 'donated.json'), 'utf8'))).toMatchObject({
      username: 'kai.ba',
      note: 'Missed a reverse holo'
    })
  })
})
