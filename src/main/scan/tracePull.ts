import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { TRACE_FILE_RE, type AdminTrace, type TraceFile } from '../../shared/traces'

/**
 * The local folder a donated trace is pulled into, beside the owner's own traces: its session,
 * then its id and sender (so the writer's pruning, which only knows bare session names, leaves it).
 */
export const pulledTraceDir = (t: Pick<AdminTrace, 'id' | 'session' | 'username'>): string =>
  `${t.session}_t${t.id}${t.username ? `-${t.username.replace(/[^A-Za-z0-9_-]/g, '')}` : ''}`

/**
 * Pulls every file of a donated trace from the portal's /admin/traces routes into
 * `<root>/<pulledTraceDir>`, a few at a time, and writes a `donated.json` with who sent it and
 * what they said. `get` fetches an /admin path as the owner (the app's account or the admin
 * token). Returns the folder.
 */
export async function pullTrace(
  trace: AdminTrace,
  root: string,
  get: (path: string) => Promise<ArrayBuffer>
): Promise<string> {
  const dir = join(root, pulledTraceDir(trace))
  await mkdir(dir, { recursive: true })
  const listed = JSON.parse(
    new TextDecoder().decode(await get(`/admin/traces/${trace.id}/files`))
  ) as { files: TraceFile[] }
  const files = listed.files.filter((f) => TRACE_FILE_RE.test(f.name))
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < files.length) {
      const { name } = files[next++]!
      const bytes = await get(`/admin/traces/${trace.id}/files/${name}`)
      await writeFile(join(dir, name), Buffer.from(bytes))
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker))
  await writeFile(
    join(dir, 'donated.json'),
    `${JSON.stringify(
      {
        id: trace.id,
        username: trace.username,
        game: trace.game,
        note: trace.note,
        appVersion: trace.appVersion,
        createdAt: trace.createdAt
      },
      null,
      2
    )}\n`
  )
  return dir
}
