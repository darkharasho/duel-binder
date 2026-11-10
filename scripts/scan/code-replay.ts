/**
 * Replays Code mode's reader on stills, to tune it on real phone shots (a screenshot of the
 * scanner in Code mode does: crop its aim box). Each x,y,w,h box is cut from the PNG and scaled
 * to at most 900 wide, as the phone grabs it, then read as the app reads a frame: darkBands'
 * bands voting, codeBands' only when none of them names a card. A code "names a card" when it
 * matches --catalog (a regex; default every code of the --code's set, so a misread digit counts
 * as the wrong card it would be).
 *
 *   npm run scan:code-replay -- shot.png 148,980,996,234 [more boxes] --code YAC1-JP057
 *     [--shrink 0.5]   also reads each box at this size (a code held further off)
 *     [--save dir]     writes every band as a PNG
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { createOcr } from '../../src/main/scan/ocr'
import type { OcrBand, RgbaImage } from '../../src/shared/scan/types'
import { setCodeCandidates } from '../../src/shared/scan/setCode'
import { codeBands, darkBands } from '../../src/renderer/src/features/scan/codeMode'

function load(path: string): RgbaImage {
  const png = PNG.sync.read(readFileSync(path))
  return { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) }
}

/** The box x,y,w,h of img, scaled by s with each output pixel the mean of those it covers. */
function cutScaled(
  img: RgbaImage,
  x: number,
  y: number,
  w: number,
  h: number,
  s: number
): RgbaImage {
  const W = Math.max(1, Math.round(w * s))
  const H = Math.max(1, Math.round(h * s))
  const out = new Uint8ClampedArray(W * H * 4)
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const sum = [0, 0, 0, 0]
      let n = 0
      const ya = y + Math.floor(j / s)
      const xa = x + Math.floor(i / s)
      for (let yy = ya; yy < Math.max(ya + 1, y + Math.floor((j + 1) / s)); yy++)
        for (let xx = xa; xx < Math.max(xa + 1, x + Math.floor((i + 1) / s)); xx++) {
          const p = (Math.min(img.height - 1, yy) * img.width + Math.min(img.width - 1, xx)) * 4
          for (let c = 0; c < 4; c++) sum[c] += img.data[p + c]
          n++
        }
      out.set(
        sum.map((v) => v / n),
        (j * W + i) * 4
      )
    }
  return { width: W, height: H, data: out }
}

function savePng(path: string, b: OcrBand): void {
  const png = new PNG({ width: b.width, height: b.height })
  for (let i = 0; i < b.width * b.height; i++) {
    png.data[i * 4] = png.data[i * 4 + 1] = png.data[i * 4 + 2] = b.data[i]
    png.data[i * 4 + 3] = 255
  }
  writeFileSync(path, PNG.sync.write(png))
}

function option(args: string[], name: string): string | undefined {
  const at = args.indexOf(name)
  return at >= 0 ? args.splice(at, 2)[1] : undefined
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const code = option(args, '--code')
  const save = option(args, '--save')
  const shrink = Number(option(args, '--shrink') ?? 0)
  const catalogArg = option(args, '--catalog')
  if (!code || args.length < 2) {
    console.error('usage: code-replay <png> <x,y,w,h>… --code <code> [--catalog re] [--shrink f]')
    process.exit(2)
  }
  // By default, every code of the code's own set and region: YAC1-JP057 → ^YAC1-JP\d{3}$.
  const catalog = new RegExp(catalogArg ?? `^${code.replace(/\d+$/, (d) => `\\d{${d.length}}`)}$`)
  if (save) mkdirSync(save, { recursive: true })
  const [file, ...rects] = args
  const src = load(file)
  const ocr = createOcr()
  let right = 0
  let wrong = 0
  const boxes: [string, RgbaImage][] = []
  for (const rect of rects) {
    const [x, y, w, h] = rect.split(',').map(Number)
    boxes.push([rect, cutScaled(src, x, y, w, h, Math.min(1, 900 / w))])
    if (shrink)
      boxes.push([`${rect}@${shrink}`, cutScaled(src, x, y, w, h, Math.min(1, 900 / w) * shrink)])
  }
  for (const [k, [name, img]] of boxes.entries()) {
    const t = performance.now()
    const votes = new Map<string, number>()
    let taken: string | null = null
    for (const [vote, make] of [
      [true, darkBands],
      [false, codeBands]
    ] as const) {
      if (!vote && votes.size > 0) break
      for (const [i, band] of make(img).entries()) {
        if (save) savePng(join(save, `${k}-${vote ? 'dark' : 'old'}${i}.png`), band)
        const [text] = await ocr.read([band], 'code')
        const named = setCodeCandidates(text).find((c) => catalog.test(c))
        if (!named) continue
        if (!vote) {
          taken = named
          break
        }
        votes.set(named, (votes.get(named) ?? 0) + 1)
        if (votes.get(named)! >= 3) break
      }
    }
    const [best, next] = [...votes].sort((a, b) => b[1] - a[1])
    if (best && best[1] >= 2 && (!next || best[1] > next[1])) taken = best[0]
    if (taken === code) right++
    else if (taken) wrong++
    const tally = [...votes].map(([c, n]) => `${c}x${n}`).join(' ')
    const ms = (performance.now() - t).toFixed(0)
    console.log(`${name.padEnd(24)} ${String(taken).padEnd(12)} ${ms.padStart(4)} ms  ${tally}`)
  }
  console.log(`${right}/${boxes.length} right, ${wrong} wrong`)
  await ocr.dispose()
}
void main()
