import { useEffect, useRef, useState, type RefObject } from 'react'
import type { GameId } from '@shared/games'
import type { Language } from '@shared/languages'
import type { RgbaImage, ScanPrinting } from '@shared/scan/types'
import { api } from '@/lib/api'
import { aimRect, codeBands, codeSignals, createCodeGate, readCode } from './codeMode'
import { resolveSignals, type ScanDraft } from './resolve'

/** The pause between reads, so the camera, the UI and the OCR keep their share of the phone. */
const PAUSE_MS = 120
/** The widest the aim box is read at: wider adds OCR time, not characters. */
const MAX_WIDTH = 900
/** Failed reads in a row before Code mode gives up (until it's turned on again). */
const MAX_FAILURES = 5

/** What Code mode shows: aiming, a code with no card in the catalog, or the card just added. */
export type CodeStatus =
  | { kind: 'aim' }
  | { kind: 'unknown'; code: string }
  | { kind: 'added'; code: string; name: string }
  | { kind: 'stopped' }

export function codeStatusText(s: CodeStatus): string {
  switch (s.kind) {
    case 'aim':
      return 'Fit the set code in the box'
    case 'unknown':
      return `No card has the code ${s.code}`
    case 'added':
      return `${s.name} ${s.code} · added, aim at the next code`
    case 'stopped':
      return 'Code reading stopped after repeated errors.'
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** The aim box off the video's current frame, at most MAX_WIDTH wide; null without a frame. */
function grabAim(video: HTMLVideoElement): RgbaImage | null {
  if (!video.videoWidth || !video.videoHeight) return null
  const r = aimRect(video.videoWidth, video.videoHeight)
  const scale = Math.min(1, MAX_WIDTH / r.width)
  const width = Math.max(1, Math.round(r.width * scale))
  const height = Math.max(1, Math.round(r.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(video, r.x, r.y, r.width, r.height, 0, 0, width, height)
  const { data } = ctx.getImageData(0, 0, width, height)
  return { width, height, data }
}

/**
 * What the aim box reads on the video's current frame, band by band (codeBands), so reading can
 * stop at the first band that names a card: nothing when no line of text is found.
 */
export async function* readAim(video: HTMLVideoElement): AsyncGenerator<string> {
  const img = grabAim(video)
  if (!img) return
  for (const band of codeBands(img)) {
    const [text] = await api.scan.ocr([band], 'code')
    if (text?.trim()) yield text.trim()
  }
}

/**
 * Code mode: reads only the set code in the aim box off the camera while `running`, and adds the
 * card it names (onDraft) once the same code names a card twice running (createCodeGate). A read
 * counts only when its code is in the catalog, so a misread that parses as a code but names
 * nothing is passed over for the next band's. The card is named by resolveSignals from the code alone, so its row offers that code's rarities to cycle,
 * starting on the default rarity's when one is set. A code is taken again only after it has left
 * the box.
 */
export function useCodeReader(o: {
  videoRef: RefObject<HTMLVideoElement | null>
  running: boolean
  game: GameId
  setPrintings: ScanPrinting[] | null
  defaultRarity: string | null
  filterLanguage: Language | null
  onDraft: (draft: ScanDraft) => string
  /** For tests: what the aim box reads on a frame, band by band; readAim when left out. */
  read?: (video: HTMLVideoElement) => AsyncIterable<string>
}): CodeStatus {
  const [status, setStatus] = useState<CodeStatus>({ kind: 'aim' })
  const latest = useRef(o)
  useEffect(() => {
    latest.current = o
  })

  const { running, game } = o
  useEffect(() => {
    if (!running) return
    let live = true
    const gate = createCodeGate()
    let failures = 0

    // A code read twice running that names no card, said once it reads again.
    let unknown: string | null = null

    /** The card the frame's first band to name one names, and the first code read that named none. */
    const readFrame = async (
      video: HTMLVideoElement
    ): Promise<{ item: ScanDraft | null; missing: string | null }> => {
      let missing: string | null = null
      for await (const text of (latest.current.read ?? readAim)(video)) {
        if (!live) break
        const code = readCode(game, text)
        if (code === null) continue
        const ctx = latest.current
        const outcome = await resolveSignals(codeSignals([text]), {
          game,
          setPrintings: ctx.setPrintings,
          defaultRarity: ctx.defaultRarity,
          filterLanguage: ctx.filterLanguage,
          lookups: api.scan
        })
        if (outcome.kind === 'recognized') return { item: outcome.item, missing: null }
        missing ??= code
      }
      return { item: null, missing }
    }

    const once = async (): Promise<void> => {
      const video = latest.current.videoRef.current
      if (!video || document.hidden) return
      const { item, missing } = await readFrame(video)
      if (!live) return
      if (missing !== null && missing === unknown) setStatus({ kind: 'unknown', code: missing })
      unknown = missing
      const taken = gate.push(item?.setCode?.toUpperCase() ?? null)
      if (taken === null || item === null) return
      latest.current.onDraft(item)
      setStatus({ kind: 'added', code: item.setCode ?? taken, name: item.name })
    }

    void (async () => {
      while (live) {
        try {
          await once()
          failures = 0
        } catch (err) {
          if (++failures >= MAX_FAILURES) {
            console.warn('Code mode stopped:', err)
            if (live) setStatus({ kind: 'stopped' })
            return
          }
        }
        await sleep(PAUSE_MS)
      }
    })()
    return () => {
      live = false
      // Turned on again, it starts from aiming, not the last card it added.
      setStatus({ kind: 'aim' })
    }
  }, [running, game])

  return status
}
