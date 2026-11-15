import { type Lab, type RGB, lch, toOklab, unlch } from './color'

export interface Families {
  fams: { lab: Lab; share: number }[]
  dark: Lab
  vivid: number
  greyArt: boolean
}

/** Card frame colours, used when the art itself is too grey to give a wash (OKLCH hue + chroma). */
export const FRAME: Record<string, [hue: number, chroma: number]> = {
  normal: [80, 0.12],
  effect: [55, 0.15],
  ritual: [240, 0.13],
  fusion: [315, 0.14],
  synchro: [265, 0.09],
  xyz: [295, 0.1],
  link: [245, 0.15],
  normal_pendulum: [80, 0.12],
  effect_pendulum: [55, 0.15],
  ritual_pendulum: [240, 0.13],
  fusion_pendulum: [315, 0.14],
  synchro_pendulum: [265, 0.09],
  xyz_pendulum: [295, 0.1],
  spell: [170, 0.13],
  trap: [345, 0.14]
}
/** Below this mean chroma the art counts as grey (Dark Magician, black dragons) and the frame colour leads. */
export const GREY = 0.045

interface Picked {
  k: number
  w: number
  lab: Lab
}

const mean = (labs: Lab[]): Lab => {
  const sum = labs.reduce<Lab>((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0])
  return [sum[0] / labs.length, sum[1] / labs.length, sum[2] / labs.length]
}

const hueGap = (a: number, b: number): number => Math.min(Math.abs(a - b), 360 - Math.abs(a - b))

/**
 * The art's hue families, as many as it really has (1-5). A family counts if it carries at least
 * 15% of the strongest family's colour weight; neighbouring hue bins (under 60 degrees) are folded
 * together. Each comes back with its share of the colour, which sets how big its pool is.
 */
export function familiesFromPixels(pixels: RGB[], frameType?: string): Families {
  const px = pixels.map(toOklab)
  const vivid = px.reduce((s, p) => s + lch(p)[1], 0) / px.length
  const bins = new Map<number, { w: number; sum: Lab; n: number }>()
  for (const p of px) {
    const [L, C, H] = lch(p)
    if (C < 0.035 || L < 0.12) continue
    const k = Math.floor(H / 20)
    const b = bins.get(k) ?? { w: 0, sum: [0, 0, 0] as Lab, n: 0 }
    b.w += C
    b.n++
    b.sum = b.sum.map((v, i) => v + p[i]) as Lab
    bins.set(k, b)
  }
  const top = [...bins.entries()].sort((a, b) => b[1].w - a[1].w)
  const picked: Picked[] = []
  for (const [k, b] of top) {
    if (picked.length === 5 || b.w < top[0][1].w * 0.15) break
    const near = picked.find((p) => Math.min(Math.abs(p.k - k), 18 - Math.abs(p.k - k)) < 3)
    if (near) {
      near.w += b.w // fold neighbours into the stronger family
      continue
    }
    picked.push({ k, w: b.w, lab: b.sum.map((v) => v / b.n) as Lab })
  }
  // Grey art: the frame colour becomes the main pool; the art's strongest colour (if far enough away) stays as a smaller one.
  const frame = frameType ? FRAME[frameType] : undefined
  const greyArt = vivid < GREY
  if (greyArt && frame) {
    const [fH, fC] = frame
    const art = picked[0]
    picked.length = 0
    picked.push({ k: -2, w: 1, lab: unlch([0.6, fC, fH]) })
    if (art && hueGap(lch(art.lab)[2], fH) > 50) picked.push({ k: art.k, w: 0.55, lab: art.lab })
  }
  // One-colour art still gets a second pool so the wash has some movement: the art's next shade of
  // that colour if it has one (a lighter or darker run of the same hue), otherwise the hue nudged 35 degrees.
  if (picked.length === 1) {
    const [L0, C0, H0] = lch(picked[0].lab)
    const sameHue = px.filter((p) => {
      const [, C, H] = lch(p)
      return C >= 0.035 && hueGap(H, H0) < 50
    })
    const other = sameHue.filter((p) => Math.abs(p[0] - L0) > 0.12)
    const lab: Lab =
      other.length > sameHue.length * 0.15
        ? mean(other)
        : unlch([L0, C0 * 0.85, (H0 + 35) % 360])
    const [, C1, H1] = lch(lab)
    picked.push({
      k: -1,
      w: picked[0].w * 0.45,
      lab: unlch([L0, Math.max(C1, C0 * 0.8), Math.abs(H1 - H0) < 12 ? (H0 + 25) % 360 : H1])
    })
  }
  const total = picked.reduce((s, p) => s + p.w, 0)
  const darks = px
    .slice()
    .sort((a, b) => a[0] - b[0])
    .slice(0, px.length * 0.3)
  const dark = mean(darks)
  return { fams: picked.map((p) => ({ lab: p.lab, share: p.w / total })), dark, vivid, greyArt }
}
