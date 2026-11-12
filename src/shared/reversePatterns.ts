/**
 * Drawings of the reverse foils that carry the card's type: Scarlet & Violet's stained
 * glass, Sword & Shield's chevron tiles and Sun & Moon's rows of Energy symbols.
 * Only alpha matters, since it masks the foil: more alpha, more foil.
 */

/**
 * The Energy symbols, 24 units across around 0,0, even-odd so their holes are cut: traced from
 * the Scarlet & Violet basic Energy cards (Fairy and Dragon from a card's type icon).
 */
const GLYPHS: Record<string, string> = {
  Grass:
    'M3.1-11.8C2.5-11.6 0.1-10.5-0.6-10.1C-0.9-9.9-1.4-9.7-1.7-9.5C-5.4-7.5-8.5-4.6-9.9-1.9C-10.6-0.4-10.9 1.7-10.5 3.2C-9.8 5.5-7.6 7.2-4.5 8C-3.9 8.1-3.8 8.2-3.7 8.8C-3.6 9.4-3.3 10.7-3 11.4L-2.8 11.9-1.4 11.9C0.2 12 0.1 12-0.1 11.4C-0.1 11-0.4 8.9-0.4 8.6C-0.4 8.4-0.3 8.4-0.1 8.3C4.9 7.5 8.3 5.9 9.7 3.8C10.9 2 10.3-1.3 8.2-5C7.9-5.5 7.6-6 7.5-6.2C7.2-6.7 5.6-9.1 4.8-10.1C4.1-11.1 3.6-11.8 3.6-11.9C3.6-12 3.6-12 3.1-11.8M1.5-8.7C0.7-7.4 0.1-6.3-0.4-5.4C-1-4.2-1-4.2-1.3-4.5C-2.3-5.3-4-5.7-5-5.4C-5.4-5.3-5.3-5.1-4.8-5.1C-3.7-4.9-2.8-4.4-1.9-3.2L-1.6-2.7-1.9-2.1C-2-1.8-2.1-1.4-2.1-1.4C-2.1-1.2-2.2-1.2-2.5-1.5C-3.6-2.2-6-2.3-7.5-1.8C-7.8-1.6-7.7-1.6-6.8-1.5C-5.3-1.5-4.2-1-3.2-0.1L-2.7 0.3-2.8 0.8C-2.8 1.1-2.9 1.7-3 2.1L-3.1 2.9-3.7 2.5C-4.9 1.8-7.1 1.6-8.3 2.2C-8.7 2.4-8.6 2.5-7.8 2.5C-6.6 2.5-6.1 2.7-4.9 3.3C-4.7 3.4-4.2 3.8-3.9 4.2C-3.2 4.8-3.2 4.9-3.1 5.3C-2.9 7-2.3 9-2 9C-2 9-1.9 8.9-1.9 8.6C-1.9 8.4-1.9 7.7-1.9 7C-1.8 5.8-1.8 5.7-1.5 5.3C-1.2 4.9-0.2 4 0.5 3.7C2 2.9 4.7 2.6 6.9 2.9C7.5 3 7.3 2.8 6.6 2.6C5.2 2.1 4.7 2.1 2.9 2.1C1.4 2.1 1.2 2.1 0.5 2.3C0.1 2.4-0.2 2.6-0.3 2.6C-0.3 2.6-0.6 2.8-0.9 3L-1.5 3.3-1.5 2.9C-1.3 1.7-1.2 1.1-1.2 1C-1 0.7 0.2 0 0.9-0.4C2.8-1.3 4.7-1.5 6.6-1C7.4-0.7 7.7-0.7 7.5-0.9C7.4-1 6.3-1.6 5.9-1.7C5.7-1.7 5.3-1.8 5-1.9C3.6-2.3 1.1-2-0.2-1.3C-0.7-1.1-0.7-1.1-0.7-1.2C-0.7-1.3-0.6-1.6-0.5-1.9C-0.4-2.6-0.2-2.8 0.6-3.3C2.1-4.3 3.3-4.7 5.1-4.7C6.6-4.7 6.7-4.8 5.3-5.2C3.8-5.5 2-5.3 0.8-4.7C0.5-4.6 0.2-4.5 0.2-4.5C0.2-4.6 0.7-5.8 1.1-6.9C1.3-7.4 1.6-8 1.8-8.4C1.9-8.8 2.1-9.1 2.1-9.1C2.1-9.4 1.8-9.2 1.5-8.7',
  Fire: 'M-2-11.9C-2-11.8-1.9-11.6-1.7-11.3C-0.4-9.3-0.6-8.3-2.9-6.4C-4.3-5.3-5.3-4.2-5.7-3.5C-6.1-2.6-6.1-1.5-5.8-0.6C-5.4 0.4-5.6 0.5-6.3-0.3C-7.4-1.5-7.7-3.1-7.1-4.6C-6.9-5.1-6.7-5.5-6.6-5.7C-6.3-6.2-6.7-6-7.5-5.2C-9.1-3.6-9.8-2.3-9.9-0.6C-10 1.1-9.6 2.3-8.3 4.3C-7.9 4.8-7.6 5.2-7.7 5.2C-8 5.3-9.9 4.1-10.7 3.2C-11.1 2.9-11.3 2.7-11.3 2.8C-11.3 3.1-10.7 4.9-10.4 5.6C-8.3 9.7-4.9 12-0.4 12C1.5 12 3.5 11.5 4.9 10.6C6.7 9.5 7.9 8.2 9.1 6.2C10.1 4.6 11.3 1.2 11.1 1C11 1 10.7 1.3 10.4 1.6C9.2 2.7 7.8 3.5 6.4 3.8C5.8 4 5.4 4 5.6 3.8C5.6 3.7 5.9 3.5 6.3 3.2C6.6 3 7.3 2.4 7.7 2C9.4 0.2 9.8-1.6 8.9-3.5C8.7-3.9 8.5-4.3 8.4-4.3C8.4-4.3 8.3-4.1 8.2-3.8C7.8-2.3 6.4-1.3 4.1-0.8C3.8-0.7 3.5-0.7 3.4-0.7C3.4-0.8 3.4-1.1 3.4-1.6C3.9-5.3 2.3-9.5-0.1-11C-0.9-11.6-1.9-12-2-11.9M-0.9 0.9C-3.2 1.9-3.7 3-2.5 4.2C-1.8 5-1.8 5.5-2.4 6.3C-2.7 6.6-2.8 6.6-2.8 6.3C-2.8 5.6-3.8 4.9-4.9 5L-5.2 5-4.9 5.2C-3.9 5.7-3.8 6.7-4.6 7.5C-5.1 8.2-5.1 8.7-4.5 9.4C-3.7 10.4-1 11 0.8 10.6C3.3 10.1 4.1 9.3 3.4 8C2.4 6.2 2.4 5.5 3.2 4.7C3.8 4.1 3.8 4.1 3.2 4.2C2.5 4.2 1.7 4.6 1.3 5.1C0.9 5.6 0.8 5.6 0.8 5C0.8 4.1 0.5 3.6-0.4 3.1C-0.7 2.8-0.7 2.8-0.7 2.5C-0.7 2.2-0.5 1.5-0.1 1C0.2 0.6 0 0.6-0.9 0.9',
  Water:
    'M9.3-11.9C9.2-11.9 8.4-11.8 7.5-11.7C-2.8-10.6-9.6-6.5-11.5-0.2C-11.9 0.8-12 2.7-11.8 3.9C-11.5 5.9-10.1 7.8-7.7 9.4C-7.2 9.7-6.8 10-6.8 10C-6.7 10-6.4 10.2-5.9 10.4C-4.1 11.2-3.4 11.5-1.8 11.7C0.8 12 4.1 11.7 6 11C9 9.9 10.7 7 10 4.4C9.7 3 9.1 2.2 7.2 0.2C5.8-1.2 5.6-1.4 5.1-2.4C3.4-5.8 4.3-8.3 7.8-10.3C8.4-10.6 10.7-11.5 11.5-11.7C11.8-11.8 12-11.8 12-11.9C12-12 9.8-12 9.3-11.9M-5.1 6C-5.5 6.1-6 6.5-6 6.8C-6 8.1-2.7 10-0.2 10.1C2.9 10.2 2 7.9-1.5 6.5C-3 6-4.3 5.8-5.1 6',
  Lightning:
    'M1.3-10.9C0.9-10.3 0.3-9.5 0.1-9.1C-0.2-8.8-0.6-8.2-0.8-7.8C-1.1-7.5-1.5-6.9-1.8-6.5C-2-6.1-2.5-5.5-2.7-5.2C-3.9-3.4-4.8-2.2-4.9-2C-5-1.9-5.1-1.7-5.3-1.4C-5.5-1.1-6-0.4-6.3 0C-8 2.5-8.3 2.9-8.2 2.9C-8.2 3-7.3 2.7-6.2 2.3C-0.3 0.4 1.1-0.1 1.3-0.1C1.5-0.1 1.5-0.2 0.7 2.7C0.4 4-0.2 6.1-0.6 7.4C-0.9 8.7-1.3 10.2-1.5 10.7C-1.7 11.7-1.7 12-1.4 11.4C-1.3 11.2-0.9 10.5-0.6 10C-0.2 9.4 0.2 8.6 0.5 8.1C0.8 7.7 1 7.2 1.1 7.1C1.2 6.9 1.3 6.8 1.3 6.8C1.3 6.7 1.6 6.3 1.9 5.7C2.8 4.2 3.4 3 3.8 2.4C4 2.1 4.3 1.5 4.6 1.1C4.8 0.7 5 0.3 5.1 0.2C5.2 0 5.5-0.6 5.8-1.1C6.2-1.7 6.4-2.1 6.4-2.2C6.4-2.2 6.7-2.6 7-3.1C7.2-3.5 7.6-4.1 7.7-4.4C7.9-4.6 8-4.9 8.1-5.1C8.2-5.2 8.3-5.4 8.2-5.4C8.2-5.4 7.6-5.3 6.8-5C6-4.8 4.3-4.3 3.1-4C1.8-3.6 0.5-3.2 0.1-3.1C-0.2-3-0.6-2.9-0.6-3C-0.7-3-0.5-3.5-0.4-4.1C-0.2-4.6 0.3-6 0.7-7.1C1.2-8.9 2.1-11.6 2.2-11.9C2.2-12 2.2-12 2.1-12C2.1-12 1.7-11.5 1.3-10.9',
  Psychic:
    'M-1.7-8.5C-3.2-8.2-4-7.9-5.5-7.1C-7.5-6-10-3.2-11.5-0.6L-12 0.4-11.7 0.9C-11.5 1.2-11.4 1.4-11.3 1.5C-11.2 1.8-9.8 3.6-9.1 4.4C-6.6 7-3.7 8.4-0.6 8.6C1.4 8.8 3.8 8.2 5.4 7.2C5.7 7.1 6 6.9 6.1 6.9C6.1 6.9 6.5 6.6 7.1 6.2C8.9 4.8 11 2.4 11.9 0.6C12 0.3 11.3-1 10.5-2.1C10.3-2.4 10.1-2.7 10.1-2.8C9.8-3.2 8.5-4.7 8-5.2C6.6-6.5 4.8-7.6 3.5-8.1C2.1-8.6-0.4-8.8-1.7-8.5M2.7-6C2.7-5.9 2.7-5.9 2.8-5.9C3.1-5.7 4.3-4.6 4.8-3.9C5.9-2.4 6-0.1 5.3 1.9C4.7 3.4 3.3 4.6 1.6 5.2C0.8 5.5-1.1 5.5-1.9 5.2C-6.2 3.7-7.4-1.7-4.2-4.9C-3.5-5.7-3.4-5.8-3.6-5.8C-4.2-5.8-6.8-3.7-7.7-2.5C-7.9-2.2-8.1-2-8.2-1.9C-8.3-1.9-9.6 0.3-9.6 0.4C-9.6 0.7-8 2.8-7 3.7C-6.3 4.4-4.8 5.4-4.3 5.6C-4.1 5.7-3.8 5.8-3.7 5.8C0.8 7.8 6.2 5.8 9.1 1.1C9.7 0.3 9.7 0.4 9.3-0.3C9.1-0.6 8.9-0.9 8.8-1C8.4-1.8 6.4-4 5.8-4.5C5.6-4.5 5.3-4.8 5-5C4.5-5.4 4-5.7 3.3-5.9C2.7-6.1 2.8-6.1 2.7-6M-0.7-3.2C-0.7-3.2-0.6-3.1-0.6-3C-0.2-2.7 0.1-1.7-0.1-1.1C-0.4-0.1-1.7 0.5-2.5-0.1C-2.8-0.3-2.8-0.2-2.6 0.5C-1.8 2.6 1.1 2.7 2.2 0.7C2.9-0.6 2.3-2.5 1-3.1C0.6-3.3-0.7-3.4-0.7-3.2',
  Fighting:
    'M-4.5-11.9C-4.6-11.9-4.7-11.8-4.8-11.7L-5.1-11.5-5.1-7L-5.1-2.6-4.8-2.4C-4.6-2.1-4.6-2.1-2.9-2.1C-1.4-2.1-1.2-2.1-1-2.3L-0.7-2.5-0.7-6.9L-0.7-11.4-0.9-11.6L-1.2-11.9-2.7-11.9C-3.6-12-4.4-11.9-4.5-11.9M1.2-11.9C0.7-11.7 0.7-11.8 0.7-7L0.7-2.5 1-2.3C1.2-2.1 1.4-2.1 2.9-2.1C4.6-2.1 4.6-2.1 4.8-2.4L5.1-2.6 5.1-7C5.1-11.8 5.1-11.7 4.5-11.9C4.2-12 1.5-12 1.2-11.9M6.9-10.5C6.4-10.3 6.4-10.2 6.4-6.1L6.4-2.3 6.7-2.1C7.1-1.7 10-1.7 10.4-2.1L10.6-2.3 10.6-6.2L10.6-10.1 10.4-10.4C10.1-10.6 10.1-10.6 8.6-10.6C7.8-10.6 7-10.6 6.9-10.5M-10.4-10.3C-10.6-10.1-10.6-10.1-10.6-6.1L-10.6-2.1-10.4-2C-10.2-1.9-9.9-1.8-8.5-1.8L-6.8-1.8-6.6-2.1C-6.4-2.3-6.4-2.5-6.4-6.2L-6.4-10-6.7-10.3C-6.9-10.5-6.9-10.5-8.6-10.5C-10.1-10.5-10.2-10.5-10.4-10.3M-10.1 0.2L-10.6 0.6-10.6 4L-10.6 7.5-10.2 8L-9.8 8.4-7.8 8.5C-5.4 8.5-5.4 8.5-4.8 7.9L-4.4 7.5-4.4 6.3L-4.4 5.1-3.7 4.5L-3 3.8-1.8 3.8L-0.7 3.8-0.2 3.3L0.3 2.8 0.3 1.8C0.3 0.7 0.2 0.4-0.4 0L-0.8-0.3-5.2-0.3L-9.7-0.3-10.1 0.2M2.6 0.2L2.1 0.6 2 2.4L2 4.2 1.3 4.9L0.7 5.5-0.5 5.6C-1.6 5.6-1.6 5.6-2 5.9C-2.6 6.4-2.6 6.6-2.6 7.8L-2.6 8.9-3.1 9.4C-3.7 10-4.1 10.2-4.5 10.2C-4.8 10.2-4.9 10.4-4.9 11C-4.9 12-5.2 11.9 0 11.9C5.3 11.9 4.9 12 4.9 10.8C4.9 9.9 5 9.7 5.7 9L6.2 8.5 7.9 8.5C9.7 8.5 9.7 8.5 10.3 7.8L10.6 7.4 10.6 4L10.6 0.6 10.1 0.2L9.7-0.3 6.4-0.3L3.1-0.3 2.6 0.2',
  Darkness:
    'M-3.7-10.3C-4.3-10.3-5.5-9.7-6.5-9.1C-6.8-9-7-8.8-7-8.8C-7.2-8.8-8.2-8-8.8-7.3C-11-5.2-12-2.5-11.7 0.5C-11.3 4.4-8 8-3.7 9.2C1.1 10.6 6.1 9.3 9.2 6C10.3 4.9 11.1 3.6 11.6 2.1C12 0.9 12-1.9 11.6-3.1C10.8-5.6 9-7.8 6.6-9.2C5.3-9.9 3.6-10.6 3.6-10.4C3.6-10.3 3.7-10.1 3.9-9.9C5.6-7.9 5.3-4.3 3.2-2.8C2.1-2 1.5-1.8 0.1-1.8C-1.1-1.8-1.2-1.8-1.9-2.1C-4.9-3.5-5.8-7.2-3.8-9.8C-3.3-10.4-3.3-10.4-3.7-10.3',
  Metal:
    'M-8.4-10.3C-8.5-10.3-9.2-9.1-9.8-8.1C-10-7.7-10.2-7.3-10.3-7.2C-10.4-7-10.8-6.3-11.2-5.6L-12-4.3-11.5-3.3C-11.2-2.8-10.7-2-10.5-1.6L-10-0.8-8.5-0.8C-7.7-0.8-7-0.8-7-0.8C-7-0.8-7.2-1.3-7.6-1.8C-7.9-2.4-8.3-3.2-8.6-3.6L-9-4.3-8.7-4.6C-8.6-4.8-8.5-5.1-8.4-5.3C-8.3-5.6-7.9-6.2-7.6-6.7L-6.9-7.8-5-7.8C-3.9-7.8-3-7.8-3-7.9C-3-7.9-3.2-8.3-3.5-8.8C-3.8-9.3-4.1-9.8-4.2-10.1L-4.4-10.4-6.3-10.4C-7.4-10.4-8.4-10.4-8.4-10.3M4.3-10.2C4.3-10.1 4.2-10 4.2-9.9C4.2-9.9 3.9-9.4 3.6-8.9L3-7.9 3.5-7.8C3.7-7.8 4.6-7.7 5.5-7.7L7-7.7 7.7-6.6C8-6 8.4-5.4 8.4-5.3C8.5-5.2 8.6-4.9 8.8-4.7L9-4.3 8.7-3.7C8.5-3.4 8.2-2.9 8-2.6C7.9-2.2 7.6-1.7 7.4-1.4C6.9-0.7 6.9-0.7 8.5-0.7L10-0.7 10.2-1.1C10.3-1.4 10.5-1.6 10.6-1.7C10.6-1.8 10.8-2 10.9-2.3C11.1-2.6 11.4-3.1 11.6-3.5C11.8-3.9 12-4.2 12-4.3C12-4.3 10.8-6.5 10.1-7.7C9.9-7.9 9.7-8.3 9.6-8.5C9.6-8.6 9.3-9.1 9-9.6L8.5-10.4 6.5-10.4C4.5-10.4 4.5-10.4 4.3-10.2M-5.5-4.8C-5.5-4.7-5.2-4.1-4.8-3.5C-4.4-2.9-4.1-2.3-4.1-2.2C-4-2.1-3.7-1.5-3.3-0.9C-3-0.3-2.7 0.2-2.7 0.2C-2.7 0.2-2.4 0.8-2 1.4C-1.6 2.1-1.3 2.6-1.3 2.7C-1.3 2.7-1 3.2-0.7 3.8C-0.4 4.3-0.1 4.8 0 4.9C0 4.9 0 4.9 0.1 4.8C0.3 4.6 0.9 3.6 1.2 3C1.5 2.3 1.9 1.8 2.4 0.9C2.6 0.5 2.8 0.2 2.8 0.1C2.8 0.1 3-0.3 3.3-0.8C3.6-1.3 4-2 4.1-2.3C4.3-2.6 4.7-3.3 5-3.8C5.3-4.3 5.6-4.8 5.6-4.8C5.6-4.9 3.3-4.9 0-4.9C-4.7-4.9-5.5-4.9-5.5-4.8M-4.7 5.5C-5.1 6.1-5.5 6.7-5.5 6.8C-5.5 6.9-5.3 7.4-5 7.9C-4.7 8.4-4.2 9.2-4 9.6L-3.5 10.4 0 10.4L3.6 10.4 3.9 9.7C4.1 9.4 4.6 8.6 5 8C5.3 7.4 5.6 6.8 5.6 6.8C5.5 6.6 4.1 4.4 4.1 4.4C4 4.4 3.3 5.5 2.8 6.4C2.6 6.7 2.4 7.2 2.2 7.4L2 7.8 0.2 7.8C-2 7.8-2 7.8-2.3 7.3C-2.4 7-2.6 6.8-2.6 6.7C-2.6 6.6-3 6-3.4 5.4C-3.7 4.8-4 4.3-4 4.3C-4 4.3-4.4 4.8-4.7 5.5',
  Fairy:
    'M0.1-10C0.1-9.9-0.1-9.6-0.1-9.3C-0.3-8.6-0.5-8.1-1.1-7C-1.7-5.6-2-5.5-3.4-5.5C-4.2-5.5-4.4-5.5-4.7-5.6C-5.4-5.8-5.8-5.7-5.8-5.4C-5.8-5.1-5.6-4.9-5.1-4.8C-4.8-4.8-4.5-4.6-4.2-4.5C-4-4.3-3.7-4.1-3.5-4.1C-3.1-3.9-3-3.8-2.7-3.3C-2.7-3.2-2.5-2.9-2.3-2.9C-1.9-2.6-1.7-2.4-1.6-2C-1.5-1.8-1.2-1.4-1-1.1C-0.9-0.7-0.7-0.3-0.6-0.1C-0.6 0.1-0.4 0.5-0.3 0.7C-0.2 0.9-0.1 1.2-0.1 1.3C-0.1 1.5-0.1 1.8 0 2.1C0 2.4 0.1 2.8 0 3C0 3.4 0.1 3.9 0.3 3.9C0.5 3.9 0.6 3.4 0.5 3C0.5 2.8 0.5 2.5 0.5 2.3C0.6 2.1 0.7 1.7 0.7 1.4C0.7 1.1 0.8 0.8 1 0.5C1.1 0.2 1.3-0.3 1.5-0.7C1.8-1.7 1.8-1.6 2.6-2.6C2.7-2.7 2.8-2.9 3-2.9C3.1-3 3.3-3.2 3.4-3.3C3.8-3.8 4.1-4 4.4-4.1C4.6-4.1 4.9-4.3 5-4.4C5.2-4.6 5.6-4.8 5.9-4.9C6.4-5.1 6.6-5.3 6.5-5.5C6.4-5.6 6.3-5.6 5.8-5.5C5.5-5.5 4.8-5.4 4.1-5.4C2.5-5.4 2.6-5.3 1.7-6.8C1.5-7.1 1.4-7.3 1.4-7.4C1.4-7.4 1.2-7.7 1.1-8.1C0.8-8.6 0.8-8.7 0.8-9.2C0.8-9.9 0.4-10.3 0.1-10M7.8-7.6C7.7-7.4 8-6.5 8.5-5.8C8.6-5.6 8.7-5.3 8.7-5.1C8.7-4.9 8.9-4.5 9-4.3L9.2-3.7 9.2-2.3C9.2-0.9 9.2-0.9 9-0.5C8.9-0.3 8.8 0.1 8.7 0.4C8.7 0.7 8.6 0.9 8.4 1.2C8.2 1.4 8.1 1.7 8 1.8C7.7 2.3 6.7 3.6 6.3 3.8C6.2 3.9 5.9 4 5.7 4.1C5.4 4.2 5.1 4.4 4.8 4.6C4.6 4.8 4.2 5 4 5.1C3.7 5.3 3.4 5.5 3 5.9C2.5 6.5 2.4 6.5 1.7 8C0.9 9.7 0.7 10.2 0.9 10.3C1.1 10.3 3 10.2 3.6 10C7.4 9.2 10.5 6.4 11.7 2.6C12 2 12 1.9 12 0.6C12-0.7 12-0.9 11.9-1.3C11.8-1.5 11.7-1.9 11.7-2.1C11.6-2.9 10.8-4.7 10.3-5.3C10.1-5.4 9.9-5.8 9.7-6C9.2-7 7.9-8 7.8-7.6M-7.8-6.6C-12-0.3-8.4 8.4-0.9 10C-0.6 10.1-0.3 10.1-0.3 10.1C-0.2 10-0.5 9.2-1.1 8.1C-1.4 7.5-1.8 6.8-1.9 6.6C-2 6.4-2.3 6-2.9 5.5C-3.6 4.8-3.8 4.6-4.4 4.4C-4.7 4.2-5.1 3.9-5.2 3.8C-5.4 3.7-5.6 3.5-5.8 3.4C-6.3 3.1-7.3 2.1-7.4 1.8C-7.5 1.7-7.7 1.4-7.8 1.2C-8 0.9-8.1 0.7-8.2 0.3C-8.3 0-8.4-0.4-8.5-0.6C-8.7-1-8.7-1-8.7-2.2L-8.7-3.5-8.5-4C-8.4-4.3-8.2-4.8-8.2-5C-8.1-5.2-7.9-5.6-7.8-5.9C-7.6-6.2-7.3-7.2-7.3-7.3C-7.4-7.3-7.6-7-7.8-6.6',
  Dragon:
    'M-3-11.8C-6-10.9-8.6-8.9-10-6.4C-10.7-5.1-10.6-5.3-10.7-3.9C-10.7-1.8-10.6-0.6-10.3 0C-10.2 0.2-10 0.8-10 1.2C-9.9 1.6-9.7 2.1-9.5 2.6C-8.7 4.2-8.4 4.6-7.4 5.6C-6.9 6.2-6.2 7-5.8 7.3C-5.5 7.7-5.1 8.1-4.9 8.2C-4.7 8.3-4.5 8.5-4.3 8.6C-4.1 8.8-3.8 9-3.6 9.1C-3.4 9.2-3 9.5-2.6 9.8C-2.3 10.1-1.9 10.5-1.7 10.6C-1.5 10.7-1.3 10.9-1.1 11C0.3 12 4.5 11.1 7.1 9.2C8.4 8.3 9.7 6.8 10.5 5.5L10.7 5.1 10 4.5C9.7 4.2 9.2 3.7 9 3.5C8.2 2.6 7.2 1.6 6.7 1.2C6.3 0.9 5.7 0.3 5.2-0.2C4.7-0.6 4.2-1 4-1.2C3.7-1.3 3.3-1.7 2.7-2.2C2.2-2.7 1.7-3.1 1.6-3.2C1.4-3.3 1-3.7 0.5-4.1C-0.4-4.9-0.6-5.1-0.9-5C-1.2-5-1.1-4.5-0.7-4C-0.6-3.8-0.4-3.5-0.4-3.2C-0.3-3-0.2-2.6-0.1-2.5C-0.1-2.3 0-2 0-1.8C0.1-1 0.5 0.6 0.7 1.1C0.9 1.5 1 1.8 1 2.3C1 2.6 1.1 3.1 1.1 3.2C1.2 3.4 1.2 3.6 1.2 3.7C1.1 4 0.6 4.1 0.2 3.9C-0.6 3.5-1.1 3.1-1.7 2.5C-2.6 1.6-3 1.1-3.5 0.1C-3.7-0.4-3.9-0.8-4-1C-4.1-1.2-4.2-1.6-4.3-2C-4.4-2.3-4.6-2.8-4.7-3.1C-5.2-4.2-5-5-3.8-7.2C-3.3-8.1-1.8-9.3-1.1-9.4C-0.9-9.4-0.6-9.6-0.3-9.7C0.1-9.9 0.2-9.9 1.4-9.9C2.5-10 2.7-10 3.1-9.8C3.4-9.7 3.7-9.7 3.9-9.6C4.7-9.5 5.7-9.2 6.5-8.8C7.1-8.4 8.3-7.9 8.4-8C8.5-8.1 8.1-8.6 7.8-8.8C6.8-9.8 4.2-11.1 2.7-11.3C2.2-11.4 1.7-11.5 1.2-11.8L0.7-12-0.8-12C-2.3-12-2.4-12-3-11.8M3.8 2.6C3.5 2.8 3.7 4.1 4.1 4.5C4.9 5.3 6.5 5.6 6.7 5.1C6.9 4.8 6.6 4.5 5.4 3.5C4.5 2.7 4.1 2.5 3.8 2.6',
  Colorless:
    'M0 -12L2.8 -4.8L10.4 -6L5.6 0L10.4 6L2.8 4.8L0 12L-2.8 4.8L-10.4 6L-5.6 0L-10.4 -6L-2.8 -4.8Z'
}

/** Each type's tint: the pattern is this colour, printed into the card at rest. */
const TINTS: Record<string, string> = {
  Grass: '#7fc25e',
  Fire: '#f08a5a',
  Water: '#5aa9e6',
  Lightning: '#e8c53a',
  Psychic: '#b07ad0',
  Fighting: '#e09a4e',
  Darkness: '#3a6c78',
  Metal: '#a4adba',
  Dragon: '#c7a84a',
  Fairy: '#ee9cc6',
  Colorless: '#bfc2cd',
  plain: '#bfc2cd'
}

/** Dark cards need the pattern lightened into them; on the rest it prints darker than the card. */
const DARK = new Set(['Darkness'])

const WIDTH = 733
const HEIGHT = 1024
/** The card's border stays plain: the pattern stops at this inset. */
const INSET = 29
const INNER = WIDTH - INSET * 2

const svgUrl = (defs: string, body: string): string => {
  const box = INSET
  const h = HEIGHT - INSET * 2
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${WIDTH} ${HEIGHT}' preserveAspectRatio='none'>` +
    `<defs>${defs}<clipPath id='c'><rect x='${box}' y='${box}' width='${INNER}' height='${h}' rx='14'/></clipPath></defs>` +
    `<g clip-path='url(#c)'>${body}</g></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

const glyphDef = (glyph: string | null): string =>
  glyph ? `<path id='g' fill-rule='evenodd' d='${glyph}'/>` : ''

/** A Poké Ball, the symbol on Sword & Shield's Trainers and Energy. */
const POKE_BALL =
  'M-10.9-1.5A11 11 0 0 1 10.9-1.5H4.2A4.5 4.5 0 0 0-4.2-1.5Z' +
  'M-10.9 1.5A11 11 0 0 0 10.9 1.5H4.2A4.5 4.5 0 0 1-4.2 1.5Z' +
  'M0-2.4A2.4 2.4 0 1 0 0 2.4A2.4 2.4 0 1 0 0-2.4Z'

/**
 * Sword & Shield: columns of upward chevron tiles, each column half a tile off its neighbours,
 * split by thin lead lines, with the symbol large and dark in every tile. A few tiles print
 * stronger or fainter than the rest, as the foil does.
 */
function chevrons(glyph: string | null): string {
  const shape = glyph ?? POKE_BALL
  const columns = 7
  const w = INNER / columns
  const h = 112
  const point = 26
  const lead = 2.2
  const half = w / 2
  // Peak at 0,0; the next tile's peak at 0,h.
  const tile = `M${n1(-half)} ${point}L0 0L${n1(half)} ${point}V${point + h}L0 ${h}L${n1(-half)} ${point + h}Z`
  const scale = ((w * 0.6) / 24).toFixed(3)
  const random = seededRandom(`swsh:${shape}`)
  const parts: string[] = []
  for (let col = 0; col < columns; col++) {
    const cx = INSET + col * w + half
    const offset = col % 2 === 0 ? 0 : h / 2
    for (let top = INSET - h - point + offset; top < HEIGHT; top += h) {
      const pick = random()
      const tone = pick < 0.14 ? 0.42 : pick < 0.26 ? 0.04 : 0.16
      parts.push(
        `<use href='#t' transform='translate(${n1(cx)} ${n1(top)})' fill-opacity='${tone}'/>`,
        `<use href='#g' transform='translate(${n1(cx)} ${n1(top + point / 2 + h / 2)}) scale(${scale})' ` +
          `fill-opacity='${(0.62 + random() * 0.3).toFixed(2)}'/>`
      )
    }
  }
  const defs =
    `<path id='t' d='${tile}' stroke='#000' stroke-opacity='.95' stroke-width='${lead}'/>` +
    `<path id='g' fill-rule='evenodd' d='${shape}'/>`
  return svgUrl(defs, parts.join(''))
}

/** A thin ring, standing in for the symbol on Trainers and Energy. */
const RING =
  'M0-11A11 11 0 1 0 0 11A11 11 0 1 0 0-11ZM0-7.5A7.5 7.5 0 1 1 0 7.5A7.5 7.5 0 1 1 0-7.5Z'

/**
 * Where Sun & Moon's big symbol sits (centre as a share of the card) and its width. The Water drop
 * fills its whole box and leans its tip up-right, so at the default size only the tip's swoosh
 * showed: it is printed smaller and lower, the whole drop on the card, as Poliwrath UNB 39 has it.
 */
const BIG_PLACE: Record<string, { x: number; y: number; size: number }> = {
  default: { x: 0.26, y: 0.72, size: 0.95 },
  Water: { x: 0.4, y: 0.68, size: 0.66 }
}

/**
 * Sun & Moon: one huge symbol low on the left, partly off the card, and a dense grid of small
 * symbols in staggered rows over the whole card, fainter where they run behind the big one.
 */
function symbols(type: string, glyph: string | null): string {
  // Trainers and Energy: filled Poké Balls in the grid, and the big one an outlined ring.
  const shape = glyph ?? POKE_BALL
  const bigShape = glyph ?? RING
  const step = INNER / 8.5
  const scale = ((step * 0.86) / 24).toFixed(3)
  const place = BIG_PLACE[type] ?? BIG_PLACE.default
  const big = (WIDTH * place.size) / 24
  const [bx, by] = [WIDTH * place.x, HEIGHT * place.y]
  // The grid runs right up to the big symbol and on behind it, fainter inside it, and the big
  // symbol is printed over it as a thick band round its outline.
  const bigAt = `transform='translate(${n1(bx)} ${n1(by)}) scale(${big.toFixed(2)})'`
  const grid: string[] = []
  for (let row = 0; row * step * 0.9 < HEIGHT; row++) {
    const y = INSET + step / 2 + row * step * 0.9
    const shift = row % 2 === 0 ? 0 : step / 2
    for (let col = -1; col < 10; col++) {
      const x = INSET + step / 2 + col * step + shift
      grid.push(`<use href='#g' transform='translate(${n1(x)} ${n1(y)}) scale(${scale})'/>`)
    }
  }
  const tiles = grid.join('')
  const parts = [
    `<g mask='url(#bo)' fill-opacity='.95'>${tiles}</g>`,
    `<g clip-path='url(#bi)' fill-opacity='.3'>${tiles}</g>`,
    `<use href='#b' fill-opacity='.18'/>`,
    `<use href='#b' fill='none' stroke='#000' stroke-width='1.1' ` +
      `stroke-linejoin='round' stroke-opacity='.8'/>`
  ]
  const defs =
    `<path id='g' fill-rule='evenodd' d='${shape}'/>` +
    `<path id='b' fill-rule='evenodd' clip-rule='evenodd' d='${bigShape}' ${bigAt}/>` +
    `<clipPath id='bi'><use href='#b'/></clipPath>` +
    `<mask id='bo'><rect width='${WIDTH}' height='${HEIGHT}' fill='#fff'/><use href='#b' fill='#000'/></mask>`
  return svgUrl(defs, parts.join(''))
}

/** The same numbers for the same seed, so a type's glass never changes. */
function seededRandom(seed: string): () => number {
  let h = 2166136261
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return () => {
    h = (h + 0x6d2b79f5) | 0
    let t = Math.imul(h ^ (h >>> 15), 1 | h)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Point = [number, number]

/** A polygon cut down to the side of the line halfway from `a` to `b` that holds `a`. */
function clipToCloser(polygon: Point[], a: Point, b: Point): Point[] {
  const mid: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  const normal: Point = [b[0] - a[0], b[1] - a[1]]
  const side = (p: Point): number => (p[0] - mid[0]) * normal[0] + (p[1] - mid[1]) * normal[1]
  const out: Point[] = []
  polygon.forEach((p, i) => {
    const q = polygon[(i + 1) % polygon.length]
    const [sp, sq] = [side(p), side(q)]
    if (sp <= 0) out.push(p)
    if (sp < 0 !== sq < 0) {
      const t = sp / (sp - sq)
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t])
    }
  })
  return out
}

const centreOf = (polygon: Point[]): Point => [
  polygon.reduce((n, p) => n + p[0], 0) / polygon.length,
  polygon.reduce((n, p) => n + p[1], 0) / polygon.length
]

const n1 = (n: number): number => Math.round(n * 10) / 10

/** A cell shrunk towards its centre for the lead line, its corners rounded off like a cobble. */
function cobble(polygon: Point[], gap: number): string {
  const c = centreOf(polygon)
  const shrunk = polygon.map(([x, y]): Point => {
    const d = Math.hypot(x - c[0], y - c[1]) || 1
    return [x - ((x - c[0]) / d) * gap, y - ((y - c[1]) / d) * gap]
  })
  const between = (i: number): Point => {
    const [p, q] = [shrunk[i], shrunk[(i + 1) % shrunk.length]]
    return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]
  }
  const first = between(shrunk.length - 1)
  const corners = shrunk.map((p, i) => {
    const m = between(i)
    return `Q${n1(p[0])} ${n1(p[1])} ${n1(m[0])} ${n1(m[1])}`
  })
  return `M${n1(first[0])} ${n1(first[1])}${corners.join('')}Z`
}

/** A symbol at a size, outlined; `size` is its width in card units. */
const outlineGlyph = (x: number, y: number, size: number, width: number): string => {
  const scale = size / 24
  return (
    `<use href='#g' transform='translate(${n1(x)} ${n1(y)}) scale(${scale.toFixed(2)})' ` +
    `fill='none' stroke='#000' stroke-width='${(width / scale).toFixed(2)}'/>`
  )
}

/** The wheel: a spiked ring, a ring of wedges with a small symbol in each, a hub with a big one. */
function wheel(cx: number, cy: number, r: number, hasGlyph: boolean): string {
  const rays = 24
  const inner = r * 0.84
  const wedgeOut = r * 0.8
  const wedgeIn = r * 0.42
  const at = (radius: number, a: number): string =>
    `${n1(cx + radius * Math.cos(a))} ${n1(cy + radius * Math.sin(a))}`
  const spikes: string[] = []
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2
    spikes.push(at(r, a), at(inner, a + Math.PI / rays))
  }
  const hubR = r * 0.36
  const circle = `M${n1(cx - hubR)} ${n1(cy)}a${n1(hubR)} ${n1(hubR)} 0 1 0 ${n1(hubR * 2)} 0a${n1(hubR)} ${n1(hubR)} 0 1 0 ${n1(-hubR * 2)} 0Z`
  const wedges = 12
  const gap = 0.03
  const holes: string[] = []
  const parts: string[] = []
  for (let i = 0; i < wedges; i++) {
    const a0 = (i / wedges) * Math.PI * 2 + gap
    const a1 = ((i + 1) / wedges) * Math.PI * 2 - gap
    const wedge =
      `M${at(wedgeIn, a0)}L${at(wedgeOut, a0)}A${wedgeOut} ${wedgeOut} 0 0 1 ${at(wedgeOut, a1)}` +
      `L${at(wedgeIn, a1)}A${wedgeIn} ${wedgeIn} 0 0 0 ${at(wedgeIn, a0)}Z`
    holes.push(wedge)
    parts.push(`<path d='${wedge}' fill-opacity='${i % 2 ? 0.34 : 0.14}'/>`)
    if (hasGlyph) {
      const m = (a0 + a1) / 2
      const rm = (wedgeOut + wedgeIn) / 2
      parts.push(outlineGlyph(cx + rm * Math.cos(m), cy + rm * Math.sin(m), r * 0.22, 2.5))
    }
  }
  // The dark ring and the lead between wedges: the spiked disc with the wedges and hub cut out.
  parts.unshift(
    `<path fill-rule='evenodd' d='M${spikes.join('L')}Z${holes.join('')}${circle}' fill-opacity='.95'/>`,
    `<path d='${circle}' fill-opacity='.14'/>`
  )
  if (hasGlyph) parts.push(outlineGlyph(cx, cy, r * 0.44, 4))
  return parts.join('')
}

/** Scarlet & Violet: stained-glass cells of two or three tones with a big wheel at lower right. */
function glass(type: string, glyph: string | null): string {
  const random = seededRandom(`glass/${type}`)
  const [left, top, right, bottom] = [INSET, INSET, WIDTH - INSET, HEIGHT - INSET]
  const bounds: Point[] = [
    [left, top],
    [right, top],
    [right, bottom],
    [left, bottom]
  ]
  const columns = 8
  const rows = 12
  const sites: Point[] = []
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      sites.push([
        left + ((col + 0.5 + (random() - 0.5) * 0.85) * (right - left)) / columns,
        top + ((row + 0.5 + (random() - 0.5) * 0.85) * (bottom - top)) / rows
      ])
    }
  }
  const reach = ((right - left) / columns) * 3.2
  const tones: string[] = ['', '', '']
  const symbols: string[] = []
  const wheelAt: Point = [WIDTH * 0.66, HEIGHT * 0.67]
  const wheelR = WIDTH * 0.2
  sites.forEach((site, i) => {
    let cell = bounds
    sites.forEach((other, j) => {
      if (i === j || Math.hypot(other[0] - site[0], other[1] - site[1]) > reach) return
      cell = clipToCloser(cell, site, other)
    })
    if (cell.length < 3) return
    tones[Math.floor(random() * tones.length)] += cobble(cell, 5)
    // Scattered cells carry the symbol, any size; those crossing the edge are cut by it.
    const pick = random()
    const size = 34 + random() * 58
    const [cx, cy] = centreOf(cell)
    const clearOfWheel = Math.hypot(cx - wheelAt[0], cy - wheelAt[1]) > wheelR + size / 2
    if (glyph && clearOfWheel && cy > HEIGHT * 0.46 && pick < 0.34) {
      symbols.push(outlineGlyph(cx, cy, size, 4))
    }
  })
  const shapes = tones.map((d, i) => `<path id='s${i}' d='${d}'/>`).join('')
  const hub = `<circle cx='${wheelAt[0]}' cy='${wheelAt[1]}' r='${wheelR}' fill='#000'/>`
  const defs =
    `${shapes}${glyphDef(glyph)}` +
    // The lead is everything that isn't a cell; the wheel lies over the cells.
    `<mask id='lead'><rect width='${WIDTH}' height='${HEIGHT}' fill='#fff'/>` +
    `<use href='#s0' fill='#000'/><use href='#s1' fill='#000'/><use href='#s2' fill='#000'/>${hub}</mask>` +
    `<mask id='open'><rect width='${WIDTH}' height='${HEIGHT}' fill='#fff'/>${hub}</mask>`
  const body =
    `<rect width='${WIDTH}' height='${HEIGHT}' mask='url(#lead)' fill-opacity='.95'/>` +
    `<g mask='url(#open)'><use href='#s0' fill-opacity='.12'/><use href='#s1' fill-opacity='.3'/>` +
    `<use href='#s2' fill-opacity='.5'/>${symbols.join('')}</g>` +
    wheel(wheelAt[0], wheelAt[1], wheelR, glyph !== null)
  return svgUrl(defs, body)
}

export type PatternEra = 'sv' | 'swsh' | 'sm'

export interface EraPattern {
  url: string
  tint: string
  restBlend: 'multiply' | 'screen'
}

const made = new Map<string, EraPattern>()

/**
 * An era's reverse pattern for a type; `plain` is the one on Trainers and Energy (Poké Balls, or
 * no symbol in Scarlet & Violet's glass). Null for a type with no glyph. Drawn on first use and kept.
 */
export function eraPattern(era: PatternEra, type: string): EraPattern | null {
  const glyph = type === 'plain' ? null : GLYPHS[type]
  if (glyph === undefined) return null
  const key = `${era}/${type}`
  let pattern = made.get(key)
  if (!pattern) {
    pattern = {
      url:
        era === 'sv' ? glass(type, glyph) : era === 'swsh' ? chevrons(glyph) : symbols(type, glyph),
      tint: TINTS[type],
      restBlend: DARK.has(type) ? 'screen' : 'multiply'
    }
    made.set(key, pattern)
  }
  return pattern
}
