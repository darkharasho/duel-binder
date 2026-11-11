/**
 * How a Pokémon Reverse Holofoil printing looks, drawn over the one flat image every finish shares:
 * the card's own reverse pattern where we have drawn its era's (Scarlet & Violet's stained glass,
 * Sword & Shield's chevrons, Sun & Moon's Energy symbols), and everywhere a dimmed, duller body
 * around the art, the way the foil film mutes the print (Mega Evolution's reverses, and the eras
 * whose patterns aren't drawn). The art itself and the card's border are left alone.
 */
import { eraPattern, type EraPattern, type PatternEra } from './reversePatterns'

/** A box, as percent of the card: `top`/`bottom` from its top, `left`/`right` inset. */
export interface Box {
  top: number
  bottom: number
  left: number
  right: number
}

/** A circle, as percent of the card's width (`cx`, `r`) and height (`cy`). */
export interface Circle {
  cx: number
  cy: number
  r: number
}

/** A traced outline, as `[x, y]` percent of the card. */
export type Outline = readonly (readonly [number, number])[]

export type Shape = Box | Circle | Outline

/** Where the body starts inside the card's border, as percent of the card. */
export interface Border {
  /** From the left (and the right, unless `right` is given). */
  x: number
  /** From the top (and the bottom, unless `bottom` is given). */
  y: number
  right?: number
  bottom?: number
  /** The body's corner: its radius in pixels of a 733 × 1024 card (default 14). */
  corner?: number
  /** Cut straight across rather than rounded (Sun & Moon). */
  chamfer?: boolean
}

export interface Layout {
  /** The art window, left plain. */
  art: Shape
  border: Border
  /** The silver Pokédex bar under a Pokémon's art; left plain too. */
  strip?: Shape
  /** Silver weakness, resistance and retreat bars printed over the body; left plain. */
  bars?: Shape
  /** A Stage 1 or Stage 2 Pokémon's previous-evolution badge, where it reaches the body. */
  badge?: Shape
  /**
   * Where the drawn pattern fades in from the top, as percent of the card: clear above the first,
   * full from the second, so the name, HP and the Basic, Stage or TRAINER heading stay legible.
   */
  fade: readonly [number, number]
}

/** A frame style: from the sets that print it. */
export type Era =
  'wotc' | 'ereader' | 'ex' | 'dp' | 'hgss' | 'bw' | 'xy' | 'evo' | 'sm' | 'swsh' | 'sv' | 'me'

/**
 * A frame: an era's, or a set's whose art (as the catalog has it) is cropped differently from the
 * rest of its era.
 */
export type Frame = Era | 'sm-late' | 'sm-lot' | 'sm-teu'

export type LayoutName = Frame | `${Frame}-trainer`

/**
 * Fitted on each era's art as the app shows it (733 × 1024; TCGdex's 600 × 825 scaled to it), on
 * early, middle and late sets, Pokémon (Basic and evolved) and Trainers. Where sources disagree by
 * a pixel or two the border reaches the outer one: a dulled sliver of border shows less than a
 * bright one of body.
 */
export const LAYOUTS: Record<LayoutName, Layout> = {
  wotc: {
    art: { top: 11.6, bottom: 50.8, left: 10.5, right: 10.5 },
    border: { x: 5.5, y: 4 },
    fade: [9, 12]
  },
  'wotc-trainer': {
    art: { top: 15.2, bottom: 55.8, left: 9.2, right: 7.8 },
    border: { x: 5.5, y: 4 },
    fade: [13, 16]
  },
  ereader: {
    art: { top: 10.8, bottom: 48.5, left: 9.7, right: 4.2 },
    border: { x: 4, y: 3 },
    fade: [8.5, 11.5]
  },
  'ereader-trainer': {
    art: { top: 15.4, bottom: 51.5, left: 9.7, right: 10 },
    border: { x: 4, y: 3 },
    fade: [13, 16]
  },
  ex: {
    art: { top: 7.2, bottom: 48.6, left: 5.5, right: 5.5 },
    border: { x: 2, right: 1.9, y: 1.3, bottom: 1.2, corner: 8 },
    strip: [
      [3.8, 48.8],
      [4.9, 46.7],
      [23.9, 46.7],
      [22.6, 48.6],
      [20.5, 49.5],
      [5.2, 49.6]
    ],
    badge: [
      [16.7, 50.9],
      [15.7, 52],
      [14.1, 52.9],
      [12.3, 53.5],
      [10.3, 53.8],
      [8.3, 53.7],
      [6.4, 53.3],
      [4.7, 52.5],
      [3.4, 51.5],
      [2.5, 50.3],
      [2.2, 49],
      [2.4, 47.7],
      [3.1, 46.5],
      [4.3, 45.4],
      [5.9, 44.6],
      [7.7, 44],
      [9.7, 43.8],
      [11.8, 44],
      [13.6, 44.5],
      [15, 46.7],
      [34.9, 46.7],
      [34.1, 48.5],
      [32.5, 48.7],
      [31.1, 49.1],
      [29.2, 49.8],
      [27.3, 50.3],
      [16.6, 51.2]
    ],
    fade: [5, 7.5]
  },
  'ex-trainer': {
    art: { top: 13.9, bottom: 49.1, left: 8.3, right: 8.5 },
    border: { x: 2, right: 1.9, y: 1.3, bottom: 1.2, corner: 8 },
    fade: [11, 14]
  },
  dp: {
    art: [
      [4.8, 8],
      [94.8, 8],
      [94.8, 50.2],
      [4.8, 50.2],
      [4.8, 11.8],
      [3.8, 11.8],
      [3.8, 8.4],
      [4.8, 8.4]
    ],
    border: { x: 1.9, right: 1.8, y: 1.3, bottom: 1.2, corner: 8 },
    strip: [
      [92.6, 50],
      [93.7, 50.2],
      [94.4, 50.7],
      [94.7, 51.5],
      [94.4, 52.2],
      [93.7, 52.7],
      [92.6, 52.9],
      [6, 52.9],
      [5, 52.7],
      [4.2, 52.2],
      [4, 51.5],
      [4.2, 50.7],
      [5, 50.2],
      [6, 50]
    ],
    badge: { cx: 10.91, cy: 11.91, r: 7.5 },
    fade: [5, 8]
  },
  'dp-trainer': {
    art: { top: 13.6, bottom: 50.1, left: 8, right: 8.1 },
    border: { x: 1.9, right: 1.8, y: 1.3, bottom: 1.2, corner: 8 },
    fade: [10.5, 13.5]
  },
  hgss: {
    art: { top: 8.8, bottom: 52.6, left: 3.55, right: 4 },
    border: { x: 1.55, y: 1.1, right: 1.6, bottom: 1.1, corner: 3 },
    strip: [
      [3.07, 52.39],
      [96.04, 52.39],
      [96.59, 52.83],
      [97, 53.81],
      [96.93, 55.32],
      [2.86, 55.32],
      [2.86, 53.81]
    ],
    badge: [
      [14.94, 4.79],
      [14.68, 6.01],
      [13.92, 7.15],
      [12.72, 8.13],
      [11.15, 8.89],
      [9.33, 9.36],
      [7.37, 9.52],
      [5.41, 9.36],
      [3.58, 8.89],
      [2.01, 8.13],
      [0.81, 7.15],
      [0.05, 6.01],
      [-0.2, 4.79],
      [0.05, 3.56],
      [0.81, 2.42],
      [2.01, 1.44],
      [3.58, 0.68],
      [5.41, 0.21],
      [7.37, 0.05],
      [9.33, 0.21],
      [11.15, 0.68],
      [12.72, 1.44],
      [13.92, 2.42],
      [14.68, 3.56]
    ],
    fade: [8, 11]
  },
  'hgss-trainer': {
    art: { top: 13, bottom: 54.45, left: 4.7, right: 5.15 },
    border: { x: 1.55, y: 1.1, right: 1.6, bottom: 1.1, corner: 3 },
    fade: [13, 16]
  },
  bw: {
    art: { top: 9.25, bottom: 49.6, left: 7.05, right: 7.25 },
    border: { x: 4, y: 2.6, right: 4.05, bottom: 2.8, corner: 3 },
    strip: [
      [7.23, 49.37],
      [94.07, 49.37],
      [93.59, 49.8],
      [92.63, 50.39],
      [91.41, 51.17],
      [90.18, 51.76],
      [88.81, 52.29],
      [7.23, 52.29],
      [6.48, 52.05],
      [5.93, 51.66],
      [5.66, 50.98],
      [5.8, 50.29],
      [6.21, 49.85],
      [6.82, 49.51]
    ],
    badge: [
      [18.83, 11.23],
      [18.63, 12.28],
      [18.04, 13.29],
      [17.1, 14.18],
      [15.85, 14.93],
      [14.35, 15.5],
      [12.67, 15.85],
      [10.91, 15.97],
      [9.15, 15.85],
      [7.48, 15.5],
      [5.98, 14.93],
      [4.73, 14.18],
      [3.78, 13.29],
      [3.2, 12.28],
      [3, 11.23],
      [3.2, 10.18],
      [3.78, 9.18],
      [4.73, 8.28],
      [5.98, 7.53],
      [7.48, 6.96],
      [9.15, 6.61],
      [10.91, 6.49],
      [12.67, 6.61],
      [14.35, 6.96],
      [15.85, 7.53],
      [17.1, 8.28],
      [18.04, 9.18],
      [18.63, 10.18]
    ],
    fade: [8, 11]
  },
  'bw-trainer': {
    art: { top: 15.65, bottom: 52.1, left: 7.5, right: 7.85 },
    border: { x: 4.1, y: 2.75, right: 4.2, bottom: 2.95, corner: 3 },
    fade: [13.5, 16]
  },
  xy: {
    art: { top: 9.3, bottom: 49.45, left: 7.05, right: 7.25 },
    border: { x: 3.85, y: 2.65, right: 3.95, bottom: 2.65, corner: 3 },
    strip: [
      [7.05, 49.35],
      [94.1, 49.35],
      [94.1, 49.65],
      [92.95, 50.3],
      [91.6, 51.15],
      [90.2, 51.85],
      [88.85, 52.35],
      [7.05, 52.35],
      [6.3, 52],
      [5.6, 51.5],
      [5.55, 50.55],
      [6.15, 49.95],
      [6.8, 49.6]
    ],
    badge: [
      [18.76, 10.4],
      [18.69, 11.14],
      [18.49, 11.87],
      [18.16, 12.57],
      [17.7, 13.23],
      [17.13, 13.85],
      [16.44, 14.41],
      [15.66, 14.9],
      [14.8, 15.31],
      [13.88, 15.64],
      [12.89, 15.87],
      [11.88, 16.02],
      [10.85, 16.07],
      [9.81, 16.02],
      [8.8, 15.87],
      [7.82, 15.64],
      [6.89, 15.31],
      [6.03, 14.9],
      [5.25, 14.41],
      [4.57, 13.85],
      [3.99, 13.23],
      [3.53, 12.57],
      [3.2, 11.87],
      [3, 11.14],
      [2.93, 10.4],
      [3, 9.66],
      [3.2, 8.93],
      [3.53, 8.23],
      [3.99, 7.57],
      [4.57, 6.95],
      [5.25, 6.39],
      [6.03, 5.9],
      [6.89, 5.49],
      [7.82, 5.17],
      [8.8, 4.93],
      [9.81, 4.78],
      [10.85, 4.73],
      [11.88, 4.78],
      [12.89, 4.93],
      [13.88, 5.17],
      [14.8, 5.49],
      [15.66, 5.9],
      [16.44, 6.39],
      [17.13, 6.95],
      [17.7, 7.57],
      [18.16, 8.23],
      [18.49, 8.93],
      [18.69, 9.66]
    ],
    fade: [8, 11]
  },
  'xy-trainer': {
    art: { top: 15.7, bottom: 52.95, left: 7.45, right: 7.6 },
    border: { x: 3.85, y: 2.65, right: 3.95, bottom: 2.65, corner: 3 },
    fade: [13, 16]
  },
  evo: {
    art: { top: 12.65, bottom: 54.25, left: 9.1, right: 9.7 },
    border: { x: 3.8, y: 2.7, right: 3.95, bottom: 2.65, corner: 3 },
    strip: { top: 55.3, bottom: 58.9, left: 14, right: 14.35 },
    badge: [
      [25.44, 9.67],
      [24.65, 10.32],
      [24.26, 10.94],
      [24.66, 11.68],
      [23.55, 12.11],
      [24.02, 12.95],
      [23.58, 13.55],
      [23.18, 14.18],
      [21.71, 14.19],
      [21.09, 14.61],
      [20.2, 14.79],
      [19.51, 15.11],
      [18.83, 15.42],
      [18.22, 15.86],
      [17.59, 16.37],
      [17, 17.17],
      [15.94, 16.78],
      [15.09, 17.06],
      [14.19, 17.72],
      [13.28, 17.06],
      [12.44, 16.78],
      [11.31, 17.36],
      [10.39, 17.15],
      [9.26, 17.24],
      [9.24, 15.8],
      [8.98, 14.99],
      [8.18, 14.79],
      [7.29, 14.61],
      [7.03, 13.97],
      [6.76, 13.39],
      [6.21, 12.96],
      [5.66, 12.52],
      [4.83, 12.11],
      [3.58, 11.7],
      [4.25, 10.92],
      [3.72, 10.32],
      [2.73, 9.67],
      [3.59, 9],
      [4.25, 8.41],
      [3.58, 7.63],
      [4.83, 7.23],
      [5.66, 6.82],
      [6.21, 6.37],
      [6.59, 5.86],
      [7.03, 5.37],
      [7.44, 4.83],
      [8.18, 4.54],
      [8.98, 4.35],
      [9.72, 4.13],
      [10.21, 3.56],
      [10.78, 2.97],
      [11.38, 2.17],
      [12.44, 2.55],
      [13.27, 2.18],
      [14.19, 1.46],
      [15.1, 2.18],
      [15.94, 2.55],
      [17, 2.17],
      [17.64, 2.88],
      [18.17, 3.56],
      [18.86, 3.87],
      [19.51, 4.23],
      [20.2, 4.54],
      [21.09, 4.73],
      [21.4, 5.34],
      [22.23, 5.64],
      [23.88, 5.66],
      [24.02, 6.39],
      [23.67, 7.2],
      [24.66, 7.66],
      [24.13, 8.41],
      [24.65, 9.01]
    ],
    fade: [10.5, 12.5]
  },
  'evo-trainer': {
    art: { top: 22.35, bottom: 56.5, left: 8.5, right: 8.2 },
    border: { x: 3.8, y: 2.7, right: 3.95, bottom: 2.65, corner: 3 },
    fade: [19, 22]
  },
  sm: {
    art: [
      [5.05, 7.8],
      [94.82, 7.8],
      [94.82, 49.37],
      [93.38, 50.59],
      [6.48, 50.59],
      [5.05, 49.51]
    ],
    border: { x: 1.55, right: 1.6, y: 1.1, bottom: 1.15, corner: 8, chamfer: true },
    bars: [
      [0, 90.5],
      [0, 87],
      [58.94, 87],
      [60.23, 87.85],
      [60.23, 89.65],
      [58.94, 90.5],
      [64.8, 90.5],
      [63.44, 89.65],
      [63.44, 87.85],
      [64.8, 87],
      [100, 87],
      [100, 90.5]
    ],
    badge: [
      [3.34, 6.3],
      [12.07, 6.3],
      [14.12, 7.76],
      [14.12, 13.09],
      [11.87, 15.09],
      [4.5, 15.09],
      [1.36, 12.89],
      [1.36, 7.67]
    ],
    fade: [6.5, 8]
  },
  'sm-trainer': {
    art: [
      [6.07, 12.35],
      [93.59, 12.35],
      [94.68, 13.13],
      [94.68, 52.15],
      [94, 52.64],
      [5.66, 52.64],
      [4.98, 52.15],
      [4.98, 13.13]
    ],
    border: { x: 1.55, right: 1.6, y: 1.1, bottom: 1.15, corner: 8, chamfer: true },
    fade: [11, 12.5]
  },
  swsh: {
    art: { top: 9.13, bottom: 47.56, left: 7, right: 7.09 },
    border: { x: 3.68, y: 2.64, right: 3.96, bottom: 2.69 },
    strip: [
      [5.87, 47.41],
      [94.68, 47.41],
      [94.27, 47.75],
      [92.91, 48.34],
      [91.27, 49.02],
      [89.36, 49.8],
      [88.27, 50.34],
      [5.73, 50.34],
      [5.25, 49.8],
      [5.05, 49.02],
      [5.25, 48.34],
      [5.73, 47.75]
    ],
    bars: [
      [0, 85.79],
      [57.84, 85.79],
      [56.62, 86.43],
      [56.14, 87.3],
      [56.34, 88.18],
      [56.68, 88.96],
      [58.05, 88.96],
      [57.91, 88.18],
      [57.78, 87.3],
      [57.98, 86.43],
      [58.94, 85.79],
      [100, 85.79],
      [100, 88.96],
      [0, 88.96]
    ],
    badge: [
      [14.73, 7.18],
      [15.26, 7.25],
      [15.7, 7.46],
      [15.99, 7.78],
      [16.1, 8.15],
      [16.1, 15.04],
      [15.99, 15.41],
      [15.7, 15.73],
      [15.26, 15.94],
      [14.73, 16.02],
      [4.91, 16.02],
      [4.39, 15.94],
      [3.95, 15.73],
      [3.65, 15.41],
      [3.55, 15.04],
      [3.55, 8.15],
      [3.65, 7.78],
      [3.95, 7.46],
      [4.39, 7.25],
      [4.91, 7.18]
    ],
    fade: [8, 11]
  },
  'swsh-trainer': {
    art: { top: 13.43, bottom: 52.49, left: 6.82, right: 7.03 },
    border: { x: 3.68, y: 2.64, right: 3.96, bottom: 2.69 },
    fade: [13, 16]
  },
  sv: {
    art: { top: 9.13, bottom: 47.46, left: 7, right: 7 },
    border: { x: 3.68, y: 2.64, right: 3.89, bottom: 2.64 },
    strip: [
      [6.28, 47.27],
      [94.95, 47.27],
      [94.68, 47.85],
      [94, 48.44],
      [92.63, 48.97],
      [92.36, 49.61],
      [92.09, 50.1],
      [91.88, 50.29],
      [5.46, 50.29],
      [5.18, 50],
      [4.77, 49.51],
      [4.77, 48.93],
      [5.05, 48.44],
      [5.66, 47.85]
    ],
    badge: [
      [8.05, 6.42],
      [8.73, 5.96],
      [14.87, 5.96],
      [15.14, 6.2],
      [16.23, 6.79],
      [17.35, 7.81],
      [17.9, 9.08],
      [18.08, 10.94],
      [17.6, 13.28],
      [16.51, 15.23],
      [13.64, 18.16],
      [9.55, 18.85],
      [7.03, 18.6],
      [5.46, 18.46],
      [4.02, 18.07],
      [3.41, 17.68],
      [3.41, 9.28],
      [3.68, 8.96],
      [4.5, 8.18],
      [5.51, 7.5],
      [6.68, 6.89]
    ],
    fade: [8, 11]
  },
  'sv-trainer': {
    art: { top: 13.43, bottom: 52.29, left: 6.89, right: 7.03 },
    border: { x: 3.68, y: 2.64, right: 3.89, bottom: 2.64 },
    fade: [13, 16]
  },
  me: {
    art: { top: 9.18, bottom: 47.51, left: 7.14, right: 6.86 },
    border: { x: 3.68, y: 2.64, right: 3.68, bottom: 2.64 },
    strip: [
      [7.23, 47.27],
      [95.09, 47.27],
      [94.95, 47.66],
      [94.61, 48.05],
      [93.86, 48.54],
      [92.7, 49.02],
      [91.88, 49.61],
      [91.68, 50],
      [91.68, 50.34],
      [5.46, 50.34],
      [5.39, 50],
      [4.98, 49.61],
      [4.91, 49.02],
      [5.18, 48.54],
      [5.66, 48.05],
      [6.41, 47.66],
      [7.09, 47.36]
    ],
    badge: [
      [8.19, 6.46],
      [8.87, 6.01],
      [15.01, 6.01],
      [15.28, 6.25],
      [16.37, 6.84],
      [17.49, 7.86],
      [18.04, 9.13],
      [18.21, 10.99],
      [17.74, 13.33],
      [16.64, 15.28],
      [13.78, 18.21],
      [9.69, 18.9],
      [7.16, 18.65],
      [5.59, 18.51],
      [4.16, 18.12],
      [3.55, 17.72],
      [3.55, 9.33],
      [3.82, 9.01],
      [4.64, 8.23],
      [5.65, 7.55],
      [6.82, 6.94]
    ],
    fade: [8, 11]
  },
  'me-trainer': {
    art: { top: 13.48, bottom: 52.37, left: 7.14, right: 6.89 },
    border: { x: 3.68, y: 2.64, right: 3.68, bottom: 2.64 },
    fade: [13, 16]
  },
  'sm-late': {
    art: [
      [7.08, 9.15],
      [92.79, 9.15],
      [92.79, 49.39],
      [91.42, 50.57],
      [8.44, 50.57],
      [7.08, 49.53]
    ],
    border: { x: 3.74, right: 3.79, y: 2.66, bottom: 2.71, corner: 8, chamfer: true },
    bars: [
      [0, 89.2],
      [0, 85.82],
      [58.53, 85.82],
      [59.76, 86.64],
      [59.76, 88.38],
      [58.53, 89.2],
      [64.13, 89.2],
      [62.83, 88.38],
      [62.83, 86.64],
      [64.13, 85.82],
      [100, 85.82],
      [100, 89.2]
    ],
    badge: [
      [5.45, 7.7],
      [13.78, 7.7],
      [15.74, 9.11],
      [15.74, 14.27],
      [13.59, 16.21],
      [6.55, 16.21],
      [3.56, 14.08],
      [3.56, 9.02]
    ],
    fade: [7.89, 9.34]
  },
  'sm-late-trainer': {
    art: [
      [8.05, 13.55],
      [91.62, 13.55],
      [92.66, 14.31],
      [92.66, 52.08],
      [92.01, 52.56],
      [7.66, 52.56],
      [7.01, 52.08],
      [7.01, 14.31]
    ],
    border: { x: 3.74, right: 3.79, y: 2.66, bottom: 2.71, corner: 8, chamfer: true },
    fade: [12.25, 13.7]
  },
  'sm-lot': {
    art: [
      [6.43, 9.24],
      [93.15, 9.24],
      [93.15, 49.44],
      [91.76, 50.62],
      [7.81, 50.62],
      [6.43, 49.58]
    ],
    border: { x: 3.05, right: 3.39, y: 2.76, bottom: 2.71, corner: 8, chamfer: true },
    bars: [
      [0, 89.21],
      [0, 85.83],
      [58.49, 85.83],
      [59.74, 86.65],
      [59.74, 88.39],
      [58.49, 89.21],
      [64.15, 89.21],
      [62.84, 88.39],
      [62.84, 86.65],
      [64.15, 85.83],
      [100, 85.83],
      [100, 89.21]
    ],
    badge: [
      [4.78, 7.79],
      [13.21, 7.79],
      [15.2, 9.2],
      [15.2, 14.36],
      [13.02, 16.29],
      [5.9, 16.29],
      [2.87, 14.16],
      [2.87, 9.12]
    ],
    fade: [7.98, 9.44]
  },
  'sm-lot-trainer': {
    art: [
      [7.42, 13.64],
      [91.96, 13.64],
      [93.02, 14.4],
      [93.02, 52.13],
      [92.36, 52.6],
      [7.02, 52.6],
      [6.37, 52.13],
      [6.37, 14.4]
    ],
    border: { x: 3.05, right: 3.39, y: 2.76, bottom: 2.71, corner: 8, chamfer: true },
    fade: [12.34, 13.79]
  },
  'sm-teu': {
    art: [
      [5.56, 8.31],
      [94.31, 8.31],
      [94.31, 49.43],
      [92.89, 50.63],
      [6.97, 50.63],
      [5.56, 49.56]
    ],
    border: { x: 2.1, right: 2.15, y: 1.69, bottom: 1.64, corner: 8, chamfer: true },
    bars: [
      [0, 90.1],
      [0, 86.64],
      [58.84, 86.64],
      [60.11, 87.48],
      [60.11, 89.26],
      [58.84, 90.1],
      [64.63, 90.1],
      [63.29, 89.26],
      [63.29, 87.48],
      [64.63, 86.64],
      [100, 86.64],
      [100, 90.1]
    ],
    badge: [
      [3.87, 6.83],
      [12.5, 6.83],
      [14.53, 8.27],
      [14.53, 13.54],
      [12.3, 15.52],
      [5.01, 15.52],
      [1.91, 13.35],
      [1.91, 8.18]
    ],
    fade: [7.03, 8.51]
  },
  'sm-teu-trainer': {
    art: [
      [6.57, 12.81],
      [93.1, 12.81],
      [94.17, 13.58],
      [94.17, 52.17],
      [93.5, 52.66],
      [6.16, 52.66],
      [5.49, 52.17],
      [5.49, 13.58]
    ],
    border: { x: 2.1, right: 2.15, y: 1.69, bottom: 1.64, corner: 8, chamfer: true },
    fade: [11.48, 12.96]
  }
}

/** Sets whose art is cropped unlike the rest of their era's. */
const FRAME_SETS: Partial<Record<Frame, readonly string[]>> = {
  'sm-late': ['DRM', 'SLG', 'HIF', 'UNB', 'UNM', 'CEC'],
  'sm-lot': ['LOT'],
  'sm-teu': ['TEU']
}

// Set-code prefixes ("SK 1/144"), the only era a printing carries.
const ERA_SETS: Record<Exclude<Era, 'sv'>, readonly string[]> = {
  wotc: [
    'BS',
    'JU',
    'FO',
    'B2',
    'RO',
    'G1',
    'G2',
    'N1',
    'N2',
    'N3',
    'N4',
    'SI',
    'LC',
    'BASEP',
    'WP'
  ],
  ereader: ['SP', 'EX', 'BOG', 'AQ', 'SK'],
  ex: [
    'RS',
    'SS',
    'DR',
    'MA',
    'HL',
    'EX5.5',
    'RG',
    'TR',
    'DX',
    'EM',
    'EXU',
    'UF',
    'DS',
    'LM',
    'HP',
    'CG',
    'DF',
    'PK',
    'NP',
    'P1',
    'P2',
    'P3',
    'P4',
    'P5'
  ],
  dp: [
    'DP',
    'DPP',
    'MT',
    'SW',
    'GE',
    'MD',
    'LA',
    'SF',
    'PL',
    'RR',
    'SV',
    'AR',
    'RM',
    'P6',
    'P7',
    'P8',
    'P9'
  ],
  hgss: ['HS', 'HGSSP', 'UL', 'UND', 'TRI', 'COL'],
  bw: [
    'BLW',
    'BWP',
    'EP',
    'NVI',
    'NXD',
    'DEX',
    'DRX',
    'DRV',
    'BCR',
    'PLS',
    'PLF',
    'PLB',
    'LTR',
    'RC'
  ],
  xy: [
    'XY',
    'XYP',
    'KSS',
    'XYA',
    'FLF',
    'FFI',
    'PHF',
    'PRC',
    'DCR',
    'ROS',
    'AOR',
    'BKT',
    'BKP',
    'GEN',
    'FCO',
    'STS'
  ],
  // Evolutions reprints Base Set's frame.
  evo: ['EVO'],
  sm: [
    'SMP',
    'SUM',
    'GRI',
    'BUS',
    'SLG',
    'CIN',
    'UPR',
    'FLI',
    'CES',
    'DRM',
    'LOT',
    'TEU',
    'DET',
    'UNB',
    'UNM',
    'HIF',
    'SMA',
    'CEC'
  ],
  swsh: [
    'SWSHP',
    'SSH',
    'RCL',
    'DAA',
    'CPA',
    'VIV',
    'SHF',
    'BST',
    'CRE',
    'EVS',
    'CEL',
    'FST',
    'BRS',
    'ASR',
    'PGO',
    'LOR',
    'SIT',
    'CRZ'
  ],
  me: ['MEG', 'PFL', 'ASC', 'POR', 'CRI', 'PBL', 'DLR', 'MEE', 'MEP', '30C']
}
const ERA_OF = new Map<string, Era>(
  Object.entries(ERA_SETS).flatMap(([era, sets]) => sets.map((s) => [s, era as Era] as const))
)

const SV_SETS = new Set([
  'SVI',
  'PAL',
  'OBF',
  'MEW',
  'PAR',
  'PAF',
  'TEF',
  'TWM',
  'SFA',
  'SCR',
  'SSP',
  'PRE',
  'JTG',
  'DRI',
  'BLK',
  'WHT',
  'SVE',
  'SVP',
  'MFB'
])
const SWSH_SETS = new Set([
  'SSH',
  'RCL',
  'DAA',
  'CPA',
  'VIV',
  'SHF',
  'BST',
  'CRE',
  'EVS',
  'FST',
  'BRS',
  'ASR',
  'PGO',
  'LOR',
  'SIT',
  'CRZ'
])
const SM_SETS = new Set([
  'SUM',
  'GRI',
  'BUS',
  'SLG',
  'CIN',
  'UPR',
  'FLI',
  'CES',
  'DRM',
  'LOT',
  'TEU',
  'DET',
  'UNB',
  'UNM',
  'HIF',
  'CEC'
])

const setPrefix = (setCode: string): string =>
  setCode.trim().split(/\s/)[0].split(':')[0].toUpperCase()

const FRAME_OF = new Map<string, Frame>(
  Object.entries(FRAME_SETS).flatMap(([frame, sets]) =>
    sets.map((s) => [s, frame as Frame] as const)
  )
)

/** The layout a printing's frame uses; any set not listed takes Scarlet & Violet's. */
export function layoutFor(setCode: string, category: string): LayoutName {
  const set = setPrefix(setCode)
  const frame = FRAME_OF.get(set) ?? ERA_OF.get(set) ?? 'sv'
  return category.trim().toLowerCase() === 'pokemon' ? frame : `${frame}-trainer`
}

function patternEra(set: string): PatternEra | null {
  if (SV_SETS.has(set)) return 'sv'
  if (SWSH_SETS.has(set)) return 'swsh'
  return SM_SETS.has(set) ? 'sm' : null
}

const W = 733
const H = 1024
const r1 = (n: number): number => Math.round(n * 10) / 10
const px = (x: number, y: number): string => `${r1((x / 100) * W)} ${r1((y / 100) * H)}`

/** A shape as an SVG path. */
function shapePath(s: Shape): string {
  if (Array.isArray(s)) {
    const pts = (s as Outline).map(([x, y]) => px(x, y))
    return `M${pts[0]}${pts
      .slice(1)
      .map((p) => `L${p}`)
      .join('')}Z`
  }
  if ('r' in s) {
    const [cx, cy, r] = [(s.cx / 100) * W, (s.cy / 100) * H, (s.r / 100) * W]
    return `M${r1(cx - r)} ${r1(cy)}a${r1(r)} ${r1(r)} 0 1 0 ${r1(2 * r)} 0a${r1(r)} ${r1(r)} 0 1 0 ${r1(-2 * r)} 0Z`
  }
  const b = s as Box
  const [x0, x1] = [(b.left / 100) * W, W - (b.right / 100) * W]
  const [y0, y1] = [(b.top / 100) * H, (b.bottom / 100) * H]
  return `M${r1(x0)} ${r1(y0)}H${r1(x1)}V${r1(y1)}H${r1(x0)}Z`
}

/** The body inside the border, with its corners rounded or cut. */
function bodyPath(b: Border): string {
  const [x0, y0] = [(b.x / 100) * W, (b.y / 100) * H]
  const [x1, y1] = [W - ((b.right ?? b.x) / 100) * W, H - ((b.bottom ?? b.y) / 100) * H]
  const c = b.corner ?? 14
  const turn = (cx: number, cy: number, x: number, y: number): string =>
    b.chamfer ? `L${r1(x)} ${r1(y)}` : `Q${r1(cx)} ${r1(cy)} ${r1(x)} ${r1(y)}`
  return (
    `M${r1(x0 + c)} ${r1(y0)}H${r1(x1 - c)}${turn(x1, y0, x1, y0 + c)}` +
    `V${r1(y1 - c)}${turn(x1, y1, x1 - c, y1)}` +
    `H${r1(x0 + c)}${turn(x0, y1, x0, y1 - c)}` +
    `V${r1(y0 + c)}${turn(x0, y0, x0 + c, y0)}Z`
  )
}

/**
 * The look's region as an SVG: white inside the border, with the art, the Pokédex bar, the stat
 * bars and (on an evolved Pokémon) the evolution badge cut out. The cut-outs are a mask, so they
 * may overlap.
 */
export function regionSvg(layout: Layout, evolved: boolean): string {
  const cuts = [layout.art, layout.strip, layout.bars, evolved ? layout.badge : undefined]
    .filter((s): s is Shape => s !== undefined)
    // One path each: shapes wound opposite ways would cancel where they overlap in one path.
    .map((s) => `<path d='${shapePath(s)}'/>`)
    .join('')
  return (
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${W} ${H}' preserveAspectRatio='none'>` +
    `<path fill='#fff' mask='url(#c)' d='${bodyPath(layout.border)}'/>` +
    `<mask id='c'><rect width='${W}' height='${H}' fill='#fff'/><g fill='#000'>${cuts}</g></mask>` +
    `</svg>`
  )
}

const masks = new Map<string, string>()
function maskFor(layout: LayoutName, evolved: boolean): string {
  const key = `${layout}${evolved ? '+evolved' : ''}`
  let mask = masks.get(key)
  if (!mask) {
    const svg = regionSvg(LAYOUTS[layout], evolved)
    mask = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
    masks.set(key, mask)
  }
  return mask
}

export interface ReverseLook {
  /** CSS mask (a url()) of the card's body around its art, inside the border. */
  region: string
  /** The era's drawn pattern, tinted by the card's type; null: only the dimmed body. */
  pattern: (EraPattern & { css: string; opacity: number; fade: string }) | null
}

export interface ReverseCard {
  /** "Pokemon", "Trainer" or "Energy"; unknown is taken as a Pokémon. */
  category?: string | null
  /** The card's Energy types; the first picks the pattern's symbol and colour. */
  types?: readonly string[] | null
  /** "Basic", "Stage1", "Stage2", "RESTORED"…: an evolved Pokémon's badge is left plain. */
  stage?: string | null
}

/** A finish is a reverse ("Reverse Holofoil", "Set Logo Reverse Holofoil", "Mirror Reverse Holo"). */
export const isReverseFinish = (finish: string | null | undefined): boolean =>
  /\breverse\b/i.test(finish ?? '')

/** Stage 1, Stage 2 and Restored Pokémon print what they come from (a Pokémon, a fossil) in a badge. */
const isEvolved = (stage: string | null | undefined): boolean =>
  /^(stage\s*[12]|restored)$/i.test(stage?.trim() ?? '')

/**
 * A Pokémon printing's reverse look, or null when its finish isn't a reverse. `setCode` is the
 * printing's ("DRI 040/182") or its set's ("DRI").
 */
export function reverseLook(
  finish: string | null | undefined,
  setCode: string,
  card: ReverseCard | null | undefined
): ReverseLook | null {
  if (!isReverseFinish(finish)) return null
  const set = setPrefix(setCode)
  const category = (card?.category ?? 'pokemon').trim().toLowerCase()
  const era = patternEra(set)
  let pattern: EraPattern | null = null
  if (era) {
    const type = category === 'pokemon' ? card?.types?.[0] : undefined
    pattern = eraPattern(era, type ?? 'plain') ?? eraPattern(era, 'plain')
  }
  const layout = layoutFor(set, category)
  const [clear, full] = LAYOUTS[layout].fade
  return {
    region: maskFor(layout, category === 'pokemon' && isEvolved(card?.stage)),
    // Sun & Moon's symbols are small, so they need more weight to read through the print.
    pattern: pattern && {
      ...pattern,
      css: `url("${pattern.url}")`,
      opacity: era === 'sm' ? 0.85 : 0.55,
      fade: `linear-gradient(transparent ${clear}%, #000 ${full}%)`
    }
  }
}

/** `reverseLook` for a printing and its card row (`type` is a Pokémon card's category). */
export function printingReverseLook(
  printing: { setRarity: string; setCode: string } | null | undefined,
  card:
    | { type?: string; pokemon?: { category: string; types: string[]; stage?: string | null } }
    | null
    | undefined
): ReverseLook | null {
  if (!printing) return null
  return reverseLook(printing.setRarity, printing.setCode, {
    category: card?.pokemon?.category ?? card?.type,
    types: card?.pokemon?.types,
    stage: card?.pokemon?.stage
  })
}

/**
 * The CSS mask size that crops a mask drawn over a whole image the way `object-cover` crops that
 * image in a frame: one side 100%, the other overflowing. Null when they're the same shape.
 */
export function coverFit(frame: number, image: number | null): string | null {
  if (!image || Math.abs(image / frame - 1) < 0.002) return null
  return image < frame
    ? `100% ${((frame / image) * 100).toFixed(2)}%`
    : `${((image / frame) * 100).toFixed(2)}% 100%`
}
