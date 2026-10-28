/**
 * GET /admin: the owner's dashboard, served only to the ADMIN_DISCORD_ID session (see app.ts). It
 * holds no data itself and reads GET /admin/stats with that session's cookie.
 * It loads only when asked: each stats read counts every table, and free-plan row reads are capped daily.
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
.chart{display:flex;align-items:flex-end;gap:3px;height:80px;margin-bottom:16px}
.chart div{flex:1;min-height:2px;background:var(--accent);border-radius:2px 2px 0 0;opacity:.85}
th{padding:6px 0;text-align:right;font-size:12px;font-weight:500;color:var(--muted)}
th:first-child{text-align:left}
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
      ['eBay price requests today', n(s.priceRequests.today)], ['… in 7 days', n(s.priceRequests.last7d)]
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

$('refresh').addEventListener('click', load)
load()
`

function csp(nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src 'nonce-${nonce}'`,
    "connect-src 'self'",
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
