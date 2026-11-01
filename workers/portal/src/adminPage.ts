/**
 * GET /admin: the owner's dashboard, served only to the ADMIN_DISCORD_ID session (see app.ts). It
 * holds no data itself and reads GET /admin/stats with that session's cookie.
 * It loads only when asked: each stats read counts every table, and free-plan row reads are capped daily.
 * Catalog and Release runs come from GitHub's public API, straight from the browser: the repository
 * is public, so that takes no secret and no portal reads. GitHub allows 60 requests an hour per IP.
 * Tabs are #links, so a tab can be opened directly (/admin#runs). They only show and hide what one
 * load already fetched; switching tabs reads nothing.
 */

/** Free-plan SQLite storage for the whole account (Durable Objects pricing, Workers Free). */
const FREE_STORAGE_BYTES = 5 * 1000 ** 3

const STYLE = `
:root{--bg:#111113;--card:#18181b;--fg:#ecebe8;--muted:#8f8d88;--line:rgb(255 255 255 / 8%);--accent:#ebbd5c;--good:#6fcf8e;--bad:#ef7d73}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,sans-serif;-webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums}
header{position:sticky;top:0;z-index:1;background:rgb(17 17 19 / 92%);border-bottom:1px solid var(--line);backdrop-filter:blur(8px)}
.wrap{max-width:1040px;margin:0 auto;padding:0 24px}
.top{display:flex;align-items:center;gap:12px;padding:14px 0 10px}
main.wrap{padding-top:20px;padding-bottom:56px}
section[data-tab]{scroll-margin-top:120px}
h1{font-size:16px;font-weight:600;margin:0}
.badge{font-size:11px;color:var(--accent);border:1px solid rgb(235 189 92 / 35%);border-radius:99px;padding:0 8px}
h2{font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin:0 0 12px}
.grow{flex:1}
.at{color:var(--muted);font-size:12px}
button{height:30px;padding:0 14px;border-radius:6px;border:1px solid rgb(255 255 255 / 14%);background:none;color:var(--fg);font:inherit;font-size:13px;cursor:pointer}
button:hover{background:rgb(255 255 255 / 5%)}
.top a{font-size:13px;color:var(--muted);text-decoration:none}
.top a:hover{color:var(--fg)}
nav{display:flex;gap:4px;overflow-x:auto}
nav a{flex:none;height:36px;line-height:34px;padding:0 12px;border-bottom:2px solid transparent;color:var(--muted);font-size:13px;text-decoration:none}
nav a:hover{color:var(--fg)}
nav a[aria-current]{color:var(--fg);border-bottom-color:var(--accent)}
.pulse{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--muted)}
.dot{flex:none;display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:6px;background:var(--muted);vertical-align:1px}
.pulse .dot{margin-right:0}
.dot.good{background:var(--good)}
.dot.bad{background:var(--bad)}
.dot.live{background:var(--accent);box-shadow:0 0 0 3px rgb(235 189 92 / 15%)}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:12px}
.tile,.panel{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px}
.tile .n{font-size:28px;font-weight:600;letter-spacing:-.02em}
.tile .l{color:var(--muted);font-size:12px}
.tile .up{color:var(--good);font-size:12px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}
.lead{display:grid;grid-template-columns:2fr 1fr;gap:12px}
.stack{display:grid;gap:12px;align-content:start}
#runs .panel + .panel{margin-top:12px}
@media (max-width:760px){.lead{grid-template-columns:1fr}}
table{width:100%;border-collapse:collapse}
td{padding:7px 0;border-top:1px solid var(--line)}
tr:first-child td{border-top:0}
td.v{text-align:right;font-weight:500}
.bar{height:8px;border-radius:4px;background:rgb(255 255 255 / 8%);overflow:hidden;margin:8px 0 4px}
.bar div{height:100%;background:var(--accent)}
.note{color:var(--muted);font-size:12px;margin:4px 0 0}
.chart{display:flex;align-items:flex-end;gap:3px;height:225px}
.chart div{flex:1;min-height:2px;background:var(--accent);border-radius:2px 2px 0 0;opacity:.85}
th{padding:6px 0;text-align:right;font-size:12px;font-weight:500;color:var(--muted)}
th:first-child{text-align:left}
.history a{color:var(--fg);text-decoration:none}
.history a:hover{text-decoration:underline}
.history td:not(:first-child){color:var(--muted)}
.run{padding:12px 0;border-top:1px solid var(--line)}
.run:first-of-type{border-top:0;padding-top:0}
.run .line{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
.run a{color:var(--fg);font-weight:500;text-decoration:none}
.run a:hover{text-decoration:underline}
.run .state{font-size:12px;font-weight:600;color:var(--muted)}
.run .state.good{color:var(--good)}
.run .state.bad{color:var(--bad)}
.run .state.live{color:var(--accent)}
.timeline{display:flex;gap:2px;height:10px;border-radius:5px;overflow:hidden;margin:10px 0 8px}
.timeline div{min-width:3px;background:rgb(255 255 255 / 18%)}
.timeline .done{background:var(--good);opacity:.8}
.timeline .live{background:var(--accent)}
.timeline .bad{background:var(--bad)}
.steps{margin:6px 0 0;padding:0;list-style:none;font-size:13px;color:var(--muted)}
.steps li{display:flex;justify-content:space-between;gap:12px;padding:5px 0;border-top:1px solid var(--line)}
.steps li:first-child{border-top:0}
.steps li.done{color:var(--fg)}
.steps li.live{color:var(--accent)}
.steps li.bad{color:var(--bad)}
details.error{padding:8px 0;border-top:1px solid var(--line)}
details.error:first-of-type{border-top:0}
details.error summary{cursor:pointer;overflow-wrap:anywhere}
details.error .count{color:var(--accent);font-weight:600;margin-right:8px}
details.error pre{margin:4px 0 8px;padding:8px;border-radius:6px;background:rgb(255 255 255 / 4%);font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere}
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
function tile(value, label, up) {
  const t = el('div', null, 'tile')
  t.append(el('div', value, 'n'), el('div', label, 'l'))
  if (up) t.append(el('div', up, 'up'))
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
  if (rows.length) p.append(table)
  return p
}

/** The database against the free-plan limit, as a panel of its own. */
function database(db) {
  const usage = el('div')
  if (db == null) usage.append(el('p', 'Size unknown.', 'note'))
  else {
    const bar = el('div', null, 'bar')
    const fill = el('div')
    fill.style.width = Math.min(100, (db / FREE) * 100).toFixed(2) + '%'
    bar.append(fill)
    usage.append(bar, el('p', bytes(db) + ' of the 5 GB free-plan limit (' + ((db / FREE) * 100).toFixed(2) + '%)', 'note'))
  }
  return panel('Database', [], usage)
}

function render(s) {
  $('tiles').replaceChildren(
    tile(n(s.users.total), 'users', '+' + n(s.users.new7d) + ' in 7 days'),
    tile(n(s.active.day), 'active today'),
    tile(n(s.active.week), 'active this week'),
    tile(n(s.active.month), 'active this month'),
    tile(n(s.collections.cards), 'cards in collections')
  )
  const db = s.storage.databaseBytes
  $('database').replaceChildren(database(db))
  const sessions = Object.entries(s.sessions).map(([k, v]) => [k, n(v)])
  $('people').replaceChildren(
    panel('Accounts', [
      ['Discord', n(s.users.discord)], ['Apple', n(s.users.apple)],
      ['New in 7 days', n(s.users.new7d)], ['New in 30 days', n(s.users.new30d)]
    ]),
    panel('Live sessions', sessions.length ? sessions : [['none', '0']]),
    panel('Collections', [
      ['Collectors', n(s.collections.collectors)], ['Entries', n(s.collections.entries)],
      ['Cards', n(s.collections.cards)]
    ]),
    panel('Friends', [
      ['Friendships', n(s.friends.accepted)], ['Pending requests', n(s.friends.pending)],
      ['Blocks', n(s.friends.blocks)]
    ]),
    panel('Largest collections', s.collections.largest.length
      ? s.collections.largest.map((r) => [r.username, n(r.entries) + ' entries · ' + n(r.cards) + ' cards'])
      : [['none yet', '']])
  )
  $('scanner').replaceChildren(
    panel('Scanner', [
      ['Scan contributions', n(s.scan.contributions)], ['… in 7 days', n(s.scan.contributions7d)]
    ]),
    panel('eBay prices', [
      ['Price requests today', n(s.priceRequests.today)], ['… in 7 days', n(s.priceRequests.last7d)],
      ['Sweep calls today', n(s.sweep.callsToday)], ['Sets swept in 7 days', n(s.sweep.sweptLast7d)],
      ['Sets in sweep queue', n(s.sweep.prefixes)]
    ])
  )
  $('storage').replaceChildren(
    database(db),
    panel('Rows by table', Object.entries(s.storage.rows).map(([k, v]) => [k, n(v) + ' rows']))
  )
  renderUsage(s.usage)
  $('at').textContent = 'Updated ' + new Date(s.at).toLocaleString()
}

const PLATFORMS = ['desktop', 'web', 'phone', 'ios']

function renderUsage(u) {
  const opens = el('section', null, 'panel')
  opens.append(el('h2', 'App opens per day'))
  const max = Math.max(1, ...u.opensByDay.map((d) => d.count))
  const chart = el('div', null, 'chart')
  for (const d of u.opensByDay) {
    const bar = el('div')
    bar.style.height = Math.max(2, (d.count / max) * 100) + '%'
    bar.title = d.day + ': ' + n(d.count) + ' opens'
    chart.append(bar)
  }
  opens.append(u.opensByDay.length ? chart : el('p', 'Nothing reported yet.', 'note'))
  $('opens').replaceChildren(opens)

  const p = el('section', null, 'panel')
  p.append(el('h2', 'Events since ' + u.since + ' (anonymous)'))
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
  $('activity').replaceChildren(p)
}

/** Reports hold text from the apps: it only ever goes in through el(), as text. */
function renderErrors(groups) {
  const p = el('section', null, 'panel')
  p.append(el('h2', 'Latest reports (anonymous)'))
  for (const g of groups) {
    const item = el('details', null, 'error')
    const summary = el('summary')
    summary.append(el('span', n(g.count) + '×', 'count'), el('span', g.message))
    item.append(summary)
    for (const r of g.reports) {
      item.append(el('p', [r.day, r.platform, r.appVersion].join(' · '), 'note'))
      if (r.stack) item.append(el('pre', r.stack))
    }
    p.append(item)
  }
  if (!groups.length) p.append(el('p', 'Nothing reported yet.', 'note'))
  $('errors').replaceChildren(p)
}

async function loadErrors() {
  try {
    const res = await fetch('/admin/errors', { credentials: 'same-origin' })
    if (!res.ok) throw new Error('The portal answered ' + res.status)
    renderErrors(await res.json())
  } catch (e) {
    $('errors').replaceChildren(el('p', String(e.message || e), 'note'))
  }
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

const realSteps = (jobs) => jobs.flatMap((j) => j.steps ?? []).filter((s) => !PLUMBING.test(s.name))
const stepDone = (s) => s.status === 'completed' && s.conclusion !== 'skipped'

function stepList(jobs) {
  const list = el('ul', null, 'steps')
  for (const s of realSteps(jobs)) {
    const [said, cls] = stepState(s)
    const item = el('li', null, cls || (stepDone(s) ? 'done' : ''))
    item.append(el('span', s.name), el('span', said))
    list.append(item)
  }
  return list
}

/** A step's seconds so far, or null before it starts. */
function stepSeconds(s) {
  if (!s.started_at) return null
  const end = s.completed_at ? new Date(s.completed_at).getTime() : Date.now()
  return Math.max(1, (end - new Date(s.started_at).getTime()) / 1000)
}

/** One bar per step, as wide as it took. A step yet to run borrows its time from the last run. */
function timeline(jobs, past) {
  const line = el('div', null, 'timeline')
  for (const s of realSteps(jobs)) {
    if (s.conclusion === 'skipped') continue
    const part = el('div', null, s.status === 'in_progress' ? 'live' : stepState(s)[1] || (stepDone(s) ? 'done' : ''))
    part.title = s.name
    part.style.flexGrow = String(stepSeconds(s) ?? past?.get(s.name) ?? 60)
    line.append(part)
  }
  return line
}

function runRow(name, r, usual, jobs, listed, past) {
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
    if (listed && jobs) row.append(timeline(jobs, past), stepList(jobs))
    return row
  }

  const elapsed = Date.now() - started(r)
  const steps = (jobs ?? []).flatMap((j) => j.steps ?? [])
  const finished = steps.filter((s) => s.status === 'completed').length
  const current = steps.find((s) => s.status === 'in_progress')
  const left = usual && elapsed < usual ? ', about ' + minutes(usual - elapsed) + ' left' : ''
  const step = current ? current.name + ' (step ' + (finished + 1) + ' of ' + steps.length + ') · ' : ''
  const said = el('p', step + minutes(elapsed) + ' so far' + left, 'note')
  if (listed && jobs) row.append(timeline(jobs, past), said, stepList(jobs))
  else {
    // Time, not steps: most of a run is one step. Held under 100 so an overrun doesn't read as done.
    const part = usual ? Math.min(0.97, elapsed / usual) : steps.length ? finished / steps.length : 0
    const bar = el('div', null, 'bar')
    const fill = el('div')
    fill.style.width = (part * 100).toFixed(1) + '%'
    bar.append(fill)
    row.append(bar, said)
  }
  return row
}

function runCell(r) {
  const cell = el('td')
  const link = el('a', r.name)
  link.href = r.html_url
  link.target = '_blank'
  link.rel = 'noopener'
  cell.append(el('span', null, 'dot ' + stateOf(r)[1]), link)
  return cell
}

const shortWhen = (r) => new Date(started(r)).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })

/** Every listed run, newest first, without asking GitHub for anything more. */
function history(all) {
  const p = el('section', null, 'panel')
  p.append(el('h2', 'History'))
  const table = el('table', null, 'history')
  const head = el('tr')
  for (const h of ['Run', 'Result', 'Trigger', 'Started', 'Took']) head.append(el('th', h))
  table.append(head)
  for (const r of all) {
    const tr = el('tr')
    tr.append(runCell(r), el('td', stateOf(r)[0], 'v'), el('td', TRIGGERS[r.event] ?? r.event, 'v'),
      el('td', shortWhen(r), 'v'), el('td', isLive(r) ? '–' : minutes(took(r)), 'v'))
    table.append(tr)
  }
  p.append(all.length ? table : el('p', 'No runs yet.', 'note'))
  return p
}

function latest(all) {
  const p = el('section', null, 'panel')
  p.append(el('h2', 'Latest runs'))
  const table = el('table', null, 'history')
  for (const r of all.slice(0, 3)) {
    const tr = el('tr')
    tr.append(runCell(r), el('td', isLive(r) ? stateOf(r)[0] : minutes(took(r)), 'v'))
    table.append(tr)
  }
  p.append(all.length ? table : el('p', 'No runs yet.', 'note'))
  return p
}

/** The header's line, on every tab: what's running, or how the last catalog went. */
function pulse(all) {
  const r = all.find(isLive) ?? all.find((x) => x.name === 'Catalog')
  if (!r) return $('pulse').replaceChildren()
  const [label, cls] = stateOf(r)
  $('pulse').replaceChildren(el('span', null, 'dot ' + cls),
    el('span', r.name + ' ' + label.toLowerCase() + (isLive(r) ? ' · ' + minutes(Date.now() - started(r)) : '')))
}

async function loadRuns() {
  clearTimeout(pollTimer)
  const box = el('section', null, 'panel')
  box.append(el('h2', 'Latest'))
  const panels = [box]
  let live = false
  try {
    const lists = await Promise.all(WATCHED.map(([, file]) => gh('/workflows/' + file + '/runs?per_page=6')))
    const all = []
    for (const [i, [name, , listed]] of WATCHED.entries()) {
      const runs = lists[i].workflow_runs
      all.push(...runs.map((r) => ({ ...r, name })))
      const usual = typical(runs)
      const shown = runs.filter(isLive)
      const last = runs.find((r) => !isLive(r))
      if (last) shown.push(last)
      const fetched = new Map()
      for (const r of shown) {
        const wanted = r.status === 'in_progress' || (listed && !isLive(r))
        fetched.set(r, wanted ? (await gh('/runs/' + r.id + '/jobs')).jobs : null)
      }
      const past = last && fetched.get(last) ? new Map(realSteps(fetched.get(last)).map((s) => [s.name, stepSeconds(s)])) : null
      for (const r of shown) {
        live ||= isLive(r)
        box.append(runRow(name, r, usual, fetched.get(r), listed, past))
      }
    }
    box.append(el('p', live ? 'Updates every 2 minutes while something runs.' : 'Nothing running.', 'note'))
    all.sort((a, b) => started(b) - started(a))
    panels.push(history(all))
    $('latest').replaceChildren(latest(all))
    pulse(all)
  } catch (e) {
    box.append(el('p', String(e.message || e), 'note'))
    $('latest').replaceChildren()
    $('pulse').replaceChildren()
  }
  $('runs').replaceChildren(...panels)
  if (live) pollTimer = setTimeout(loadRuns, POLL_MS)
}

const TABS = ['overview', 'runs', 'people', 'activity', 'errors', 'scanner', 'storage']

function showTab() {
  const wanted = location.hash.slice(1)
  const tab = TABS.includes(wanted) ? wanted : TABS[0]
  for (const t of TABS) $(t).hidden = t !== tab
  for (const a of document.querySelectorAll('nav a')) {
    if (a.getAttribute('href') === '#' + tab) a.setAttribute('aria-current', 'page')
    else a.removeAttribute('aria-current')
  }
}

window.addEventListener('hashchange', showTab)
showTab()
$('refresh').addEventListener('click', () => { load(); loadErrors(); loadRuns() })
load()
loadErrors()
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
<header><div class="wrap">
<div class="top"><h1>Duel Binder</h1><span class="badge">Admin</span><span class="pulse" id="pulse"></span>
<span class="grow"></span><span class="at" id="at"></span><a href="/">Back to the app</a><button id="refresh" type="button">Refresh</button></div>
<nav aria-label="Admin sections"><a href="#overview">Overview</a><a href="#runs">Runs</a><a href="#people">Users</a><a href="#activity">Usage</a><a href="#errors">Errors</a><a href="#scanner">Scanner &amp; prices</a><a href="#storage">Storage</a></nav>
</div></header>
<main class="wrap">
<section data-tab id="overview">
<div class="tiles" id="tiles"></div>
<div class="lead"><div id="opens"></div><div class="stack"><div id="latest"></div><div id="database"></div></div></div>
</section>
<section data-tab id="runs" hidden></section>
<section data-tab class="grid" id="people" hidden></section>
<section data-tab id="activity" hidden></section>
<section data-tab id="errors" hidden></section>
<section data-tab class="grid" id="scanner" hidden></section>
<section data-tab class="stack" id="storage" hidden></section>
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
