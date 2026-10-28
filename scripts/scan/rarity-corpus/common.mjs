/* eslint-disable @typescript-eslint/explicit-function-return-type -- a plain JS script */
// Shared helpers for the rarity reference corpus scripts (tcgplayer.mjs, yugipedia.mjs):
// polite per-host HTTP, on-disk caching, image size/sha1/thumbnail, rarity names, manifests.
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const { decode: decodeJpeg } = require('jpeg-js')
const { PNG } = require('pngjs')

export const USER_AGENT =
  'DuelBinder-rarity-corpus/0.1 (private rarity-detector evaluation; https://github.com/darkharasho/duel-binder)'
export const CORPUS = path.join(os.homedir(), 'rarity-corpus')
export const CATALOG = process.env.RC_CATALOG ?? '/tmp/rc-catalog.db'

export function openCatalog() {
  return new Database(CATALOG, { readonly: true, fileMustExist: true })
}

/** Rarities the corpus covers: canonical name -> directory slug. */
export const RARITIES = {
  'Starlight Rare': 'starlight',
  'Secret Rare': 'secret',
  'Quarter Century Secret Rare': 'quarter-century-secret',
  'Platinum Secret Rare': 'platinum-secret',
  'Prismatic Secret Rare': 'prismatic-secret',
  "Prismatic Collector's Rare": 'prismatic-collectors',
  'Prismatic Ultimate Rare': 'prismatic-ultimate',
  'Ultimate Rare': 'ultimate',
  "Collector's Rare": 'collectors',
  'Ghost Rare': 'ghost',
  'Ultra Rare': 'ultra',
  'Super Rare': 'super',
  Rare: 'rare',
  Common: 'common',
  'Gold Rare': 'gold',
  'Premium Gold Rare': 'premium-gold'
}
const BY_LOWER = new Map(Object.keys(RARITIES).map((r) => [r.toLowerCase(), r]))

/** Canonical rarity name for a stored one ("PLatinum Secret Rare" -> "Platinum Secret Rare"), or null. */
export function canonicalRarity(r) {
  if (!r) return null
  return BY_LOWER.get(r.trim().toLowerCase().replace(/’/g, "'")) ?? null
}

export const slugOf = (rarity) =>
  RARITIES[rarity] ?? rarity.toLowerCase().replace(/[^a-z0-9]+/g, '-')

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
export const sha1 = (buf) => createHash('sha1').update(buf).digest('hex')

// ---------------------------------------------------------------- polite HTTP

const MIN_GAP_MS = 250
const MAX_CONCURRENCY = 2
const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 32000]
const TIMEOUT_MS = 60_000
const hosts = new Map()

function hostState(host) {
  let s = hosts.get(host)
  if (!s) {
    s = { active: 0, lastStart: 0, waiters: [] }
    hosts.set(host, s)
  }
  return s
}

async function acquire(host) {
  const s = hostState(host)
  while (s.active >= MAX_CONCURRENCY) await new Promise((r) => s.waiters.push(r))
  s.active++
  // Space request starts at least MIN_GAP_MS apart per host.
  const start = Math.max(Date.now(), s.lastStart + MIN_GAP_MS)
  s.lastStart = start
  const wait = start - Date.now()
  if (wait > 0) await sleep(wait)
}

function release(host) {
  const s = hostState(host)
  s.active--
  s.waiters.shift()?.()
}

export class HttpMissing extends Error {}

/** GET with per-host pacing (<=2 at once, >=250 ms apart) and exponential backoff on 429/5xx/network errors. */
export async function politeGet(url, { accept } = {}) {
  const host = new URL(url).host
  let failure = 'network error'
  for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
    let retryAfter = 0
    await acquire(host)
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, ...(accept ? { Accept: accept } : {}) },
        signal: AbortSignal.timeout(TIMEOUT_MS)
      })
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer())
        return { buf, contentType: res.headers.get('content-type') ?? '' }
      }
      await res.body?.cancel()
      if (res.status === 429 || res.status >= 500) {
        failure = `HTTP ${res.status}`
        const ra = Number.parseInt(res.headers.get('retry-after') ?? '', 10)
        if (Number.isFinite(ra) && ra > 0) retryAfter = ra * 1000
      } else {
        throw new HttpMissing(`HTTP ${res.status}`)
      }
    } catch (e) {
      if (e instanceof HttpMissing) throw e
      failure = e?.message ?? 'network error'
    } finally {
      release(host)
    }
    if (attempt < BACKOFF_MS.length) await sleep(Math.max(BACKOFF_MS[attempt], retryAfter))
  }
  throw new Error(`${failure} after retries: ${url}`)
}

/** Downloads url to file unless it already exists (re-runnable). Returns the bytes. */
export async function downloadTo(url, file) {
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return fs.readFileSync(file)
  const { buf } = await politeGet(url)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file + '.part', buf)
  fs.renameSync(file + '.part', file)
  return buf
}

/** JSON GET cached on disk under cacheDir, keyed by the URL's sha1. */
export async function cachedJson(url, cacheDir) {
  fs.mkdirSync(cacheDir, { recursive: true })
  const file = path.join(cacheDir, sha1(url) + '.json')
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')).body
  const { buf } = await politeGet(url, { accept: 'application/json' })
  const body = JSON.parse(buf.toString('utf8'))
  if (body?.error?.code === 'maxlag') throw new Error('maxlag')
  fs.writeFileSync(file, JSON.stringify({ url, body }))
  return body
}

/** Runs fn over items with up to `n` in flight (host limits still apply inside politeGet). */
export async function pool(items, n, fn) {
  let i = 0
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++
      await fn(items[idx], idx)
    }
  })
  await Promise.all(workers)
}

// ---------------------------------------------------------------- images

/** Width/height from PNG IHDR or JPEG SOF, without decoding. */
export function imageSize(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50)
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++
        continue
      }
      const marker = buf[i + 1]
      if (
        marker === 0xd8 ||
        marker === 0x01 ||
        (marker >= 0xd0 && marker <= 0xd7) ||
        marker === 0xff
      ) {
        i += marker === 0xff ? 1 : 2
        continue
      }
      const len = buf.readUInt16BE(i + 2)
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }
      }
      i += 2 + len
    }
  }
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP')
    return { width: null, height: null }
  return { width: null, height: null }
}

export function imageExt(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'png'
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg'
  return null
}

function decode(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) {
    const p = PNG.sync.read(buf)
    return { width: p.width, height: p.height, data: p.data }
  }
  if (buf[0] === 0xff && buf[1] === 0xd8)
    return decodeJpeg(buf, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024 })
  return null
}

/**
 * A 24x24 RGB thumbnail (box-averaged) for near-duplicate checks, plus the fraction of pixels
 * whose colour is saturated or bright-sparkly (a coarse, informative-only "foil" signal).
 */
export function thumbnail(buf, N = 24) {
  const img = decode(buf)
  if (!img) return null
  const { width: w, height: h, data } = img
  const out = new Float32Array(N * N * 3)
  const cnt = new Float32Array(N * N)
  const step = Math.max(1, Math.floor(Math.min(w, h) / 300))
  for (let y = 0; y < h; y += step) {
    const ty = Math.min(N - 1, Math.floor((y * N) / h))
    for (let x = 0; x < w; x += step) {
      const tx = Math.min(N - 1, Math.floor((x * N) / w))
      const k = ty * N + tx
      const o = (y * w + x) * 4
      out[k * 3] += data[o]
      out[k * 3 + 1] += data[o + 1]
      out[k * 3 + 2] += data[o + 2]
      cnt[k]++
    }
  }
  for (let k = 0; k < N * N; k++) for (let c = 0; c < 3; c++) out[k * 3 + c] /= cnt[k] || 1
  return out
}

/** Mean absolute difference (0-255) between two thumbnails. */
export function thumbDiff(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity
  let s = 0
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i])
  return s / a.length
}

// ---------------------------------------------------------------- manifest

export function writeManifest(source, rows) {
  const dir = path.join(CORPUS, source)
  fs.mkdirSync(dir, { recursive: true })
  rows.sort((a, b) => a.file.localeCompare(b.file))
  fs.writeFileSync(
    path.join(dir, 'manifest.jsonl'),
    rows.map((r) => JSON.stringify(r)).join('\n') + '\n'
  )
  // Images left from an earlier selection that this run no longer lists.
  const keep = new Set(rows.map((r) => r.file))
  let pruned = 0
  for (const sub of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!sub.isDirectory() || sub.name === 'cache') continue
    for (const f of fs.readdirSync(path.join(dir, sub.name))) {
      if (!/\.(png|jpe?g|gif|webp)$/i.test(f) || keep.has(path.join(sub.name, f))) continue
      fs.unlinkSync(path.join(dir, sub.name, f))
      pruned++
    }
  }
  if (pruned) console.log(`pruned ${pruned} images no longer in the manifest`)
}

/** Distinct canonical-ish en rarities of a card in a set code, per card_printings. */
export function availableRarities(db) {
  const q = db.prepare(
    `SELECT DISTINCT set_rarity FROM card_printings WHERE language = 'en' AND card_id = ? AND set_code = ? COLLATE NOCASE`
  )
  const memo = new Map()
  return (cardId, setCode) => {
    if (cardId == null || !setCode) return []
    const k = `${cardId}|${setCode}`
    if (!memo.has(k))
      memo.set(
        k,
        [
          ...new Set(
            q
              .pluck()
              .all(cardId, setCode)
              .map((r) => canonicalRarity(r) ?? r)
          )
        ].sort()
      )
    return memo.get(k)
  }
}

export function log(...a) {
  console.log(new Date().toISOString().slice(11, 19), ...a)
}
