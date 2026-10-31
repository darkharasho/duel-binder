/**
 * GET /admin: the owner's dashboard, served only to the ADMIN_DISCORD_ID session (see app.ts). It
 * holds no data itself and reads GET /admin/stats with that session's cookie.
 * It loads only when asked: each stats read counts every table, and free-plan row reads are capped daily.
 * Catalog and Release runs come from GitHub's public API, straight from the browser: the repository
 * is public, so that takes no secret and no portal reads. GitHub allows 60 requests an hour per IP.
 */

/** Free-plan SQLite storage for the whole account (Durable Objects pricing, Workers Free). */
const FREE_STORAGE_BYTES = 5 * 1000 ** 3

const STYLE = `
:root{--bg:#111113;--card:#18181b;--fg:#ecebe8;--muted:#8f8d88;--line:rgb(255 255 255 / 8%);--accent:#ebbd5c}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,sans-serif;-webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums}
main{max-width:1040px;margin:0 auto;padding:32px 24px 56px}
header{display:flex;align-items:center;gap:12px;margin-bottom:24px}
h1{font-size:20px;font-weight:600;margin:0}
h2{font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin:0 0 12px}
.grow{flex:1}
.at{color:var(--muted);font-size:12px}
button{height:32px;padding:0 14px;border-radius:6px;border:1px solid rgb(255 255 255 / 14%);background:none;color:var(--fg);font:inherit;font-size:13px;cursor:pointer}
button:hover{background:rgb(255 255 255 / 5%)}
header a{font-size:13px;color:var(--muted);text-decoration:none}
header a:hover{color:var(--fg)}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:12px}
.tile,.panel{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px}
.tile .n{font-size:28px;font-weight:600;letter-spacing:-.02em}
.tile .l{color:var(--muted);font-size:12px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}
table{width:100%;border-collapse:collapse}
td{padding:6px 0;border-top:1px solid var(--line)}
tr:first-child td{border-top:0}
td.v{text-align:right;font-weight:500}
.bar{height:8px;border-radius:4px;background:rgb(255 255 255 / 8%);overflow:hidden;margin:8px 0 4px}
.bar div{height:100%;background:var(--accent)}
.note{color:var(--muted);font-size:12px;margin:4px 0 0}
.wide{margin-top:12px}
#runs{margin-bottom:12px}
#runs .wide{margin-top:0}
.chart{display:flex;align-items:flex-end;gap:3px;height:80px;margin-bottom:16px}
.chart div{flex:1;min-height:2px;background:var(--accent);border-radius:2px 2px 0 0;opacity:.85}
th{padding:6px 0;text-align:right;font-size:12px;font-weight:500;color:var(--muted)}
th:first-child{text-align:left}
.run{padding:10px 0;border-top:1px solid var(--line)}
.run:first-of-type{border-top:0;padding-top:0}
.run .line{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
.run a{color:var(--fg);font-weight:500;text-decoration:none}
.run a:hover{text-decoration:underline}
.run .state{font-size:12px;font-weight:600;color:var(--muted)}
.run .state.good{color:#6fcf8e}
.run .state.bad{color:#ef7d73}
.run .state.live{color:var(--accent)}
.steps{margin:6px 0 0;padding:0;list-style:none;font-size:12px;color:var(--muted)}
.steps li{display:flex;justify-content:space-between;gap:12px;padding:2px 0}
.steps li.live{color:var(--fg)}
.steps li.bad{color:#ef7d73}
[hidden]{display:none!important}
`

const SCRIPT = `
const $ = (id) => document.getElementById(id)
const FREE = ${FREE_STORAGE_BYTES}
const n = (v) => (v ?? 0).toLocaleString()
const bytes = (b) => b == null ? 'unknown' : b < 1e6 ? (b / 1e3).toFixed(1) + ' KB' : b < 1e9 ? (b / 1e6).toFixed(1) + ' MB' : (b / 1e9).toFixed(2) + ' GB'

function el(tag, text, cls) {
  const e = document.createElement(tag)
  if (text != null) e.textContent = text
  if (cls) e.className = cls
  return e
}
function tile(value, label) {
  const t = el('div', null, 'tile')
  t.append(el('div', value, 'n'), el('div', label, 'l'))
  return t
}
function panel(title, rows, extra) {
  const p = el('section', null, 'panel')
  p.append(el('h2', title))
  const table = el('table')
  for (const [k, v] of rows) {
    const tr = el('tr')
    tr.append(el('td', k), el('td', v, 'v'))
    table.append(tr)
  }
  if (extra) p.append(extra)
  p.append(table)
  return p
}

function render(s) {
  $('tiles').replaceChildren(
    tile(n(s.users.total), 'users'),
    tile(n(s.active.day), 'active today'),
    tile(n(s.active.week), 'active this week'),
    tile(n(s.active.month), 'active this month'),
    tile(n(s.collections.cards), 'cards in binders')
  )
  const db = s.storage.databaseBytes
  const usage = el('div')
  if (db != null) {
    const bar = el('div', null, 'bar')
    const fill = el('div')
    fill.style.width = Math.min(100, (db / FREE) * 100).toFixed(2) + '%'
    bar.append(fill)
    usage.append(bar, el('p', bytes(db) + ' of the 5 GB free-plan limit (' + ((db / FREE) * 100).toFixed(2) + '%)', 'note'))
  }
  const sessions = Object.entries(s.sessions).map(([k, v]) => [k, n(v)])
  $('panels').replaceChildren(
    panel('Users', [
      ['Discord', n(s.users.discord)], ['Apple', n(s.users.apple)],
      ['New in 7 days', n(s.users.new7d)], ['New in 30 days', n(s.users.new30d)]
    ]),
    panel('Live sessions', sessions.length ? sessions : [['none', '0']]),
    panel('Collections', [
      ['Collectors', n(s.collections.collectors)], ['Entries', n(s.collections.entries)],
      ['Cards', n(s.collections.cards)]
    ]),
    panel('Largest binders', s.collections.largest.length
      ? s.collections.largest.map((r) => [r.username, n(r.entries) + ' entries · ' + n(r.cards) + ' cards'])
      : [['none yet', '']]),
    panel('Friends', [
      ['Friendships', n(s.friends.accepted)], ['Pending requests', n(s.friends.pending)],
      ['Blocks', n(s.friends.blocks)]
    ]),
    panel('Scanner and prices', [
      ['Scan contributions', n(s.scan.contributions)], ['… in 7 days', n(s.scan.contributions7d)],
      ['eBay price requests today', n(s.priceRequests.today)], ['… in 7 days', n(s.priceRequests.last7d)],
      ['eBay sweep calls today', n(s.sweep.callsToday)], ['Sets swept in 7 days', n(s.sweep.sweptLast7d)],
      ['Sets in sweep queue', n(s.sweep.prefixes)]
    ]),
    panel('Storage', Object.entries(s.storage.rows).map(([k, v]) => [k, n(v) + ' rows']), usage)
  )
  renderUsage(s.usage)
  $('at').textContent = 'Updated ' + new Date(s.at).toLocaleString()
}

const PLATFORMS = ['desktop', 'web', 'phone', 'ios']

function renderUsage(u) {
  const p = el('section', null, 'panel wide')
  p.append(el('h2', 'Usage since ' + u.since + ' (anonymous)'))
  const max = Math.max(1, ...u.opensByDay.map((d) => d.count))
  const chart = el('div', null, 'chart')
  for (const d of u.opensByDay) {
    const bar = el('div')
    bar.style.height = Math.max(2, (d.count / max) * 100) + '%'
    bar.title = d.day + ': ' + n(d.count) + ' opens'
    chart.append(bar)
  }
  if (u.opensByDay.length) p.append(el('p', 'App opens per day', 'note'), chart)

  const byEvent = new Map()
  for (const t of u.totals) {
    const row = byEvent.get(t.event) ?? {}
    row[t.platform] = t.count
    byEvent.set(t.event, row)
  }
  const table = el('table')
  const head = el('tr')
  for (const h of ['Event', ...PLATFORMS, 'Total']) head.append(el('th', h))
  table.append(head)
  for (const [event, row] of byEvent) {
    const tr = el('tr')
    tr.append(el('td', event))
    let total = 0
    for (const pl of PLATFORMS) {
      total += row[pl] ?? 0
      tr.append(el('td', row[pl] ? n(row[pl]) : '–', 'v'))
    }
    tr.append(el('td', n(total), 'v'))
    table.append(tr)
  }
  p.append(byEvent.size ? table : el('p', 'Nothing reported yet.', 'note'))
  $('usage').replaceChildren(p)
}

async function load() {
  $('refresh').disabled = true
  try {
    const res = await fetch('/admin/stats', { credentials: 'same-origin' })
    if (res.status === 401) throw new Error('Signed out. Sign in again from the front page.')
    if (!res.ok) throw new Error('The portal answered ' + res.status)
    render(await res.json())
  } catch (e) {
    $('at').textContent = String(e.message || e)
  } finally {
    $('refresh').disabled = false
  }
}

const RUNS = 'https://api.github.com/repos/darkharasho/duel-binder/actions'
// The third value lists the run's steps; Release is several jobs, so only its progress shows.
const WATCHED = [['Catalog', 'catalog.yml', true], ['Release', 'release.yml', false]]
// GitHub's own bookkeeping, which says nothing about the job.
const PLUMBING = /^(Set up job|Complete job|Post |Run actions[/]|Check portal settings)/
const POLL_MS = 120000
const STATES = { success: ['Passed', 'good'], failure: ['Failed', 'bad'], cancelled: ['Cancelled', 'bad'], timed_out: ['Timed out', 'bad'] }
const TRIGGERS = { schedule: 'nightly', workflow_dispatch: 'manual', push: 'tag' }
let pollTimer = null

async function gh(path) {
  // no-cache revalidates by ETag, and GitHub doesn't count an unchanged answer.
  const res = await fetch(RUNS + path, { cache: 'no-cache' })
  if (res.status === 403 || res.status === 429) throw new Error('GitHub limit reached for now. It resets within the hour.')
  if (!res.ok) throw new Error('GitHub answered ' + res.status)
  return res.json()
}

const started = (r) => new Date(r.run_started_at).getTime()
const took = (r) => new Date(r.updated_at).getTime() - started(r)
const minutes = (ms) => {
  const m = Math.max(1, Math.round(ms / 60000))
  return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60) + ' min'
}
const isLive = (r) => r.status !== 'completed'

/** The usual length of this workflow's passed runs, or null with none to go on. */
function typical(runs) {
  const done = runs.filter((r) => r.conclusion === 'success').map(took).sort((a, b) => a - b)
  return done.length ? done[Math.floor(done.length / 2)] : null
}

function stateOf(r) {
  if (r.status === 'queued' || r.status === 'pending' || r.status === 'waiting') return ['Queued', 'live']
  if (isLive(r)) return ['Running', 'live']
  return STATES[r.conclusion] ?? [r.conclusion ?? 'Finished', '']
}

const seconds = (ms) => ms < 60000 ? Math.max(1, Math.round(ms / 1000)) + ' s' : minutes(ms)

/** What a step's row says on its right, and how it's coloured. */
function stepState(s) {
  if (s.status === 'in_progress') return [s.started_at ? seconds(Date.now() - new Date(s.started_at).getTime()) + ' so far' : 'running', 'live']
  if (s.status !== 'completed') return ['waiting', '']
  if (s.conclusion === 'skipped') return ['skipped', '']
  const time = s.started_at && s.completed_at ? seconds(new Date(s.completed_at) - new Date(s.started_at)) : 'done'
  return s.conclusion === 'success' ? [time, ''] : [(STATES[s.conclusion]?.[0] ?? s.conclusion) + ' · ' + time, 'bad']
}

function stepList(jobs) {
  const list = el('ul', null, 'steps')
  for (const s of jobs.flatMap((j) => j.steps ?? []).filter((s) => !PLUMBING.test(s.name))) {
    const [said, cls] = stepState(s)
    const item = el('li', null, cls)
    item.append(el('span', s.name), el('span', said))
    list.append(item)
  }
  return list
}

function runRow(name, r, usual, jobs, listed) {
  const row = el('div', null, 'run')
  const line = el('div', null, 'line')
  const link = el('a', name)
  link.href = r.html_url
  link.target = '_blank'
  link.rel = 'noopener'
  const [label, cls] = stateOf(r)
  const when = new Date(started(r)).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })
  line.append(link, el('span', label, 'state ' + cls),
    el('span', (TRIGGERS[r.event] ?? r.event) + ' · ' + when + (isLive(r) ? '' : ' · ' + minutes(took(r))), 'at'))
  row.append(line)
  if (r.status !== 'in_progress') {
    if (listed && jobs) row.append(stepList(jobs))
    return row
  }

  const elapsed = Date.now() - started(r)
  const steps = (jobs ?? []).flatMap((j) => j.steps ?? [])
  const finished = steps.filter((s) => s.status === 'completed').length
  const current = steps.find((s) => s.status === 'in_progress')
  // Time, not steps: most of a run is one step. Held under 100 so an overrun doesn't read as done.
  const part = usual ? Math.min(0.97, elapsed / usual) : steps.length ? finished / steps.length : 0
  const bar = el('div', null, 'bar')
  const fill = el('div')
  fill.style.width = (part * 100).toFixed(1) + '%'
  bar.append(fill)
  const left = usual && elapsed < usual ? ', about ' + minutes(usual - elapsed) + ' left' : ''
  const step = current ? current.name + ' (step ' + (finished + 1) + ' of ' + steps.length + ') · ' : ''
  row.append(bar, el('p', step + minutes(elapsed) + ' so far' + left, 'note'))
  if (listed && jobs) row.append(stepList(jobs))
  return row
}

async function loadRuns() {
  clearTimeout(pollTimer)
  const box = el('section', null, 'panel wide')
  box.append(el('h2', 'Catalog and releases'))
  let live = false
  try {
    const lists = await Promise.all(WATCHED.map(([, file]) => gh('/workflows/' + file + '/runs?per_page=6')))
    for (const [i, [name, , listed]] of WATCHED.entries()) {
      const runs = lists[i].workflow_runs
      const usual = typical(runs)
      const shown = runs.filter(isLive)
      const last = runs.find((r) => !isLive(r))
      if (last) shown.push(last)
      for (const r of shown) {
        const wanted = r.status === 'in_progress' || (listed && !isLive(r))
        const jobs = wanted ? (await gh('/runs/' + r.id + '/jobs')).jobs : null
        live ||= isLive(r)
        box.append(runRow(name, r, usual, jobs, listed))
      }
    }
    box.append(el('p', live ? 'Updates every 2 minutes while something runs.' : 'Nothing running.', 'note'))
  } catch (e) {
    box.append(el('p', String(e.message || e), 'note'))
  }
  $('runs').replaceChildren(box)
  if (live) pollTimer = setTimeout(loadRuns, POLL_MS)
}

$('refresh').addEventListener('click', () => { load(); loadRuns() })
load()
loadRuns()
`

function csp(nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src 'nonce-${nonce}'`,
    "connect-src 'self' https://api.github.com",
    "img-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'"
  ].join('; ')
}

export function adminPage(): Response {
  const nonce = crypto.randomUUID().replace(/-/g, '')
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Admin — Duel Binder</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style nonce="${nonce}">${STYLE}</style>
</head>
<body>
<main>
<header><h1>Duel Binder</h1><span class="at" id="at"></span><span class="grow"></span>
<a href="/">Back to the app</a><button id="refresh" type="button">Refresh</button></header>
<div id="runs"></div>
<div class="tiles" id="tiles"></div>
<div class="grid" id="panels"></div>
<div id="usage"></div>
</main>
<script nonce="${nonce}">${SCRIPT}</script>
</body>
</html>`
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': csp(nonce),
      'x-robots-tag': 'noindex',
      'referrer-policy': 'no-referrer'
    }
  })
}
