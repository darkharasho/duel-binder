import { frameGroups, LOOK_NAME_STATS, LOOK_REGION_STATS, LOOK_REGIONS } from '@shared/scan/look'
import type { RgbaImage } from '@shared/scan/types'
import { strokes, type TextLine } from './bands'
import { FRAME_STRIPS, TEXT_AREA } from './foil'
import { NAME_BAND, type Box } from './regions'

/**
 * Regions of a straightened, upright card whose look differs by rarity, and how many times each
 * is shrunk before it is measured: the name bar, the artwork (inset from its window, so its edge
 * isn't counted), the frame strips beside the artwork and the effect text. At 2 a CARD_W card is
 * measured at about the size a webcam films it; the artwork, the largest region by far, at 4.
 */
const REGIONS: Record<(typeof LOOK_REGIONS)[number], { boxes: readonly Box[]; shrink: number }> = {
  name: { boxes: [NAME_BAND], shrink: 2 },
  art: { boxes: [[0.13, 0.2, 0.88, 0.69]], shrink: 4 },
  frame: { boxes: FRAME_STRIPS, shrink: 2 },
  text: { boxes: [TEXT_AREA], shrink: 2 }
}

/** Saturation below which a pixel's hue isn't counted. */
const HUED = 0.2

/** Luma at or above which a pixel counts as a specular highlight. */
const SPECULAR = 235

/** Box mean of radius r over a w x h plane, edges clamped: running sums along rows, then columns. */
function boxMean(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)
  const side = 1 / (2 * r + 1)
  for (let y = 0; y < h; y++) {
    const row = y * w
    let acc = 0
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))]
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc * side
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)]
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc * side
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]
    }
  }
  return out
}

/** Per channel (red, green, blue), what the card's pixels are multiplied by. */
type Gain = readonly [number, number, number]

/** The level the effect text's paper is brought to on every channel. */
const PAPER = 200

/** The paper's level on a channel: this share of the text box is darker (the rest is paper). */
const PAPER_SHARE = 0.75

/**
 * Gains that bring the effect text's paper to PAPER on every channel: a white balance and
 * exposure from the one part every card prints on the same cream stock, so colour and texture
 * read alike under a warm lamp, a blue-white webcam and a flatbed scanner. Each gain is kept
 * within 0.5-3, so a glared or dark text box can't throw the rest far off.
 */
function paperGain(card: RgbaImage): Gain {
  const [bx0, by0, bx1, by1] = TEXT_AREA
  const x0 = Math.round(bx0 * card.width)
  const x1 = Math.round(bx1 * card.width)
  const y0 = Math.round(by0 * card.height)
  const y1 = Math.round(by1 * card.height)
  const histograms = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)]
  let n = 0
  for (let y = y0; y < y1; y += 2)
    for (let x = x0; x < x1; x += 2) {
      const i = (y * card.width + x) * 4
      histograms[0][card.data[i]]++
      histograms[1][card.data[i + 1]]++
      histograms[2][card.data[i + 2]]++
      n++
    }
  const level = (h: Uint32Array): number => {
    let seen = 0
    for (let v = 0; v < 256; v++) if ((seen += h[v]) >= PAPER_SHARE * n) return v + 0.5
    return 255
  }
  const gain = (h: Uint32Array): number => (n ? Math.min(3, Math.max(0.5, PAPER / level(h))) : 1)
  return [gain(histograms[0]), gain(histograms[1]), gain(histograms[2])]
}

/** One box of the card shrunk: luma, red - green, yellow - blue and HSV saturation planes. */
interface Planes {
  w: number
  h: number
  l: Float32Array
  a: Float32Array
  b: Float32Array
  sat: Float32Array
}

function planes(img: RgbaImage, box: Box, shrink: number, gain: Gain): Planes {
  const x0 = Math.round(box[0] * img.width)
  const y0 = Math.round(box[1] * img.height)
  const w = Math.max(0, Math.floor((Math.round(box[2] * img.width) - x0) / shrink))
  const h = Math.max(0, Math.floor((Math.round(box[3] * img.height) - y0) / shrink))
  const n = w * h
  const p: Planes = {
    w,
    h,
    l: new Float32Array(n),
    a: new Float32Array(n),
    b: new Float32Array(n),
    sat: new Float32Array(n)
  }
  const k = 1 / (shrink * shrink)
  const { data, width } = img
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let r = 0
      let g = 0
      let bl = 0
      for (let dy = 0; dy < shrink; dy++) {
        let i = ((y0 + y * shrink + dy) * width + x0 + x * shrink) * 4
        for (let dx = 0; dx < shrink; dx++, i += 4) {
          r += data[i]
          g += data[i + 1]
          bl += data[i + 2]
        }
      }
      r *= k * gain[0]
      g *= k * gain[1]
      bl *= k * gain[2]
      const j = y * w + x
      p.l[j] = 0.299 * r + 0.587 * g + 0.114 * bl
      p.a[j] = r - g
      p.b[j] = (r + g) / 2 - bl
      const max = Math.max(r, g, bl)
      p.sat[j] = max ? (max - Math.min(r, g, bl)) / max : 0
    }
  return p
}

/** Sums over one box, and its pixel count, so the boxes of a region pool. */
interface Sums {
  n: number
  s: Float64Array
}

const SUMS = 18

function regionSums(p: Planes): Sums {
  const { w, h, l, a, b, sat } = p
  const s = new Float64Array(SUMS)
  if (w < 9 || h < 9) return { n: 0, s }
  const l1 = boxMean(l, w, h, 1)
  const l3 = boxMean(l, w, h, 3)
  const l7 = boxMean(l, w, h, 7)
  let meanL = 0
  for (let i = 0; i < l.length; i++) meanL += l[i]
  meanL /= l.length
  const brightAt = meanL + 40
  let n = 0
  // The outermost pixels see a clamped neighbourhood; they are left out.
  for (let y = 2; y < h - 2; y++)
    for (let x = 2; x < w - 2; x++) {
      const i = y * w + x
      const v = l[i]
      const si = sat[i]
      n++
      s[0] += v
      s[1] += a[i]
      s[2] += b[i]
      s[3] += si
      s[4] += si * si
      if (si >= HUED) {
        const norm = Math.sqrt(a[i] * a[i] + b[i] * b[i])
        if (norm) {
          s[5]++
          s[16] += a[i] / norm
          s[17] += b[i] / norm
        }
      }
      if (v >= SPECULAR) s[7]++
      if (v >= brightAt) s[8]++
      const left = i - 1
      const right = i + 1
      const up = i - w
      const down = i + w
      s[9] += Math.abs(v - 0.25 * (l[left] + l[right] + l[up] + l[down]))
      s[10] += Math.abs(l1[i] - l3[i])
      s[11] += Math.abs(l3[i] - l7[i])
      s[12] +=
        Math.abs(a[i] - 0.25 * (a[left] + a[right] + a[up] + a[down])) +
        Math.abs(b[i] - 0.25 * (b[left] + b[right] + b[up] + b[down]))
      const d1 = Math.abs(l[down + 1] - l[up - 1])
      const d2 = Math.abs(l[down - 1] - l[up + 1])
      s[13] += Math.abs(l[right] - l[left]) + Math.abs(l[down] - l[up])
      s[14] += d1 + d2
      s[15] += Math.abs(d1 - d2)
    }
  return { n, s }
}

/** LOOK_REGION_STATS of a region from its boxes' pooled sums. */
function regionStats(parts: Sums[]): number[] {
  const n = parts.reduce((t, p) => t + p.n, 0)
  if (!n) return new Array<number>(LOOK_REGION_STATS.length).fill(0)
  const sum = (j: number): number => parts.reduce((t, p) => t + p.s[j], 0)
  const sat = sum(3) / n
  const hued = sum(5)
  return [
    sum(0) / n / 255,
    sum(1) / n / 255,
    sum(2) / n / 255,
    sat,
    Math.sqrt(Math.max(0, sum(4) / n - sat * sat)),
    hued / n,
    hued ? 1 - Math.hypot(sum(16), sum(17)) / hued : 0,
    sum(7) / n,
    sum(8) / n,
    sum(9) / n,
    sum(10) / n,
    sum(11) / n,
    sum(12) / n,
    sum(13) / n,
    sum(14) / n,
    sum(15) / n
  ]
}

const NO_NAME: readonly number[] = new Array<number>(LOOK_NAME_STATS.length).fill(0)

/** Hue statistics of pixels: mean saturation, its saturation-weighted hue vector, hue spread. */
class HueSums {
  n = 0
  sat = 0
  x = 0
  y = 0
  hued = 0
  ux = 0
  uy = 0
  add(sat: number, a: number, b: number): void {
    this.n++
    this.sat += sat
    const norm = Math.sqrt(a * a + b * b)
    if (!norm) return
    this.x += (sat * a) / norm
    this.y += (sat * b) / norm
    if (sat < HUED) return
    this.hued++
    this.ux += a / norm
    this.uy += b / norm
  }
  stats(): [number, number, number, number] {
    const n = this.n || 1
    const spread = this.hued ? 1 - Math.hypot(this.ux, this.uy) / this.hued : 0
    return [this.sat / n, this.x / n, this.y / n, spread]
  }
}

/**
 * The LOOK_NAME_STATS of a name line found on the band at NAME_BAND (scale 1), as on a black-name
 * frame, after the paper gain.
 */
function nameStats(band: RgbaImage, line: TextLine | null, gain: Gain): readonly number[] {
  if (!line || !line.blobs.length) return NO_NAME
  const { width, data } = band
  const { ink, halo, x0, x1, y0, y1 } = strokes(band, line)
  const inkHue = new HueSums()
  const histogram = new Uint32Array(256)
  let inkL = 0
  let inkL2 = 0
  let barL = 0
  let barSat = 0
  let bars = 0
  let haloSat = 0
  let halos = 0
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const p = y * width + x
      const r = data[p * 4] * gain[0]
      const g = data[p * 4 + 1] * gain[1]
      const b = data[p * 4 + 2] * gain[2]
      const l = 0.299 * r + 0.587 * g + 0.114 * b
      const max = Math.max(r, g, b)
      const s = max ? (max - Math.min(r, g, b)) / max : 0
      if (ink[p]) {
        inkL += l
        inkL2 += l * l
        histogram[Math.round(l)]++
        inkHue.add(s, r - g, (r + g) / 2 - b)
      } else if (!halo[p]) {
        barL += l
        barSat += s
        bars++
      }
      if (halo[p]) {
        haloSat += s
        halos++
      }
    }
  const inks = inkHue.n
  if (!inks || !bars) return NO_NAME
  barL /= bars
  barSat /= bars
  inkL /= inks
  // The brightest eighth of the ink, from its luma histogram.
  let cut = 255
  for (let seen = 0; cut > 0 && (seen += histogram[cut]) < inks / 8;) cut--
  const top = new HueSums()
  let topL = 0
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const p = y * width + x
      if (!ink[p]) continue
      const r = data[p * 4] * gain[0]
      const g = data[p * 4 + 1] * gain[1]
      const b = data[p * 4 + 2] * gain[2]
      const l = 0.299 * r + 0.587 * g + 0.114 * b
      if (Math.round(l) < cut) continue
      const max = Math.max(r, g, b)
      top.add(max ? (max - Math.min(r, g, b)) / max : 0, r - g, (r + g) / 2 - b)
      topL += l
    }
  const [inkSat, inkCos, inkSin, inkSpread] = inkHue.stats()
  const [topSat, topCos, topSin] = top.stats()
  return [
    1,
    line.sign,
    (barL - inkL) / 255,
    inkSat,
    barSat,
    inkCos,
    inkSin,
    inkSpread,
    Math.sqrt(Math.max(0, inkL2 / inks - inkL * inkL)) / 255,
    topSat,
    topCos,
    topSin,
    (topL / (top.n || 1) - barL) / 255,
    halos ? haloSat / halos - barSat : 0
  ]
}

/**
 * The colour, highlight, texture and gradient measurements of each region of a straightened,
 * upright card (CARD_W wide), and of its name's ink against the bar when a name line was found
 * (findTextLine on NAME_BAND at scale 1, band being that crop), in LOOK_FEATURES order. The frame
 * type is known only once the card is recognized, so this measures as if on a black-name frame;
 * withFrame (shared/scan/look.ts) fills in the rest.
 */
export function rarityFeatures(card: RgbaImage, line: TextLine | null, band: RgbaImage): number[] {
  const gain = paperGain(card)
  const regions = LOOK_REGIONS.flatMap((region) => {
    const { boxes, shrink } = REGIONS[region]
    return regionStats(boxes.map((box) => regionSums(planes(card, box, shrink, gain))))
  })
  return [...regions, ...nameStats(band, line, gain), ...frameGroups('normal')]
}
