/**
 * Lists or pulls the scan traces trace testers sent:
 *
 *   npm run scan:pull-trace              lists them, newest first
 *   npm run scan:pull-trace -- 12        pulls trace 12 beside this computer's own traces
 *   npm run scan:pull-trace -- 12 --out /tmp/traces
 *
 * PORTAL_URL defaults to https://app.duelbinder.com; PORTAL_ADMIN_TOKEN, when unset, is read from
 * ~/.config/duel-binder/portal-admin-token. A pulled trace lands in
 * ~/.config/duel-binder/scan-trace/<session>_t<id>-<username>/, where
 * `npx tsx scripts/scan/trace-summary.ts <dir>` reads it as any trace. Built by Vite
 * (scripts/catalog/vite.config.ts) because it imports src/.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { pullTrace } from '../../src/main/scan/tracePull'
import type { AdminTrace } from '../../src/shared/traces'

const option = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main(): Promise<void> {
  const url = (process.env['PORTAL_URL'] ?? 'https://app.duelbinder.com').replace(/\/+$/, '')
  const token =
    process.env['PORTAL_ADMIN_TOKEN'] ??
    readFileSync(join(homedir(), '.config/duel-binder/portal-admin-token'), 'utf8').trim()
  const get = async (path: string): Promise<ArrayBuffer> => {
    const res = await fetch(url + path, { headers: { authorization: `Bearer ${token}` } })
    if (!res.ok) throw new Error(`${path}: ${res.status}`)
    return res.arrayBuffer()
  }
  const { traces } = JSON.parse(new TextDecoder().decode(await get('/admin/traces'))) as {
    traces: AdminTrace[]
  }
  const wanted = process.argv.slice(2).find((a) => /^\d+$/.test(a))
  if (!wanted) {
    for (const t of traces)
      console.log(
        `${t.id}\t${t.createdAt}\t@${t.username ?? '?'}\t${t.game}\t${t.doneAt ? `${t.files} files, ${(t.bytes / 1e6).toFixed(1)} MB` : 'not finished'}\t${t.note}`
      )
    if (!traces.length) console.log('No traces sent yet.')
    return
  }
  const trace = traces.find((t) => t.id === Number(wanted))
  if (!trace) throw new Error(`No trace ${wanted}`)
  const root = (option('out') ?? '~/.config/duel-binder/scan-trace').replace(
    /^~(?=$|\/)/,
    homedir()
  )
  console.log(await pullTrace(trace, root, get))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
