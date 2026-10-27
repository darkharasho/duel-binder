import type { PackLayout, PackSlot, SlotPick } from './types'

/*
 * Researched pack layouts for English (TCG) Core Booster sets, one per era.
 *
 * Sources, in order of trust:
 * - Konami, "Booster Pack Changes in 2016" (Kevin Tewart, Sept 17 2015),
 *   https://yugiohblog.konami.com/articles/?p=7413 (archived 2015-11-06). Official: from Breakers of
 *   Shadow, 9-card packs are 7 Commons + 1 Rare + 1 foil; Ultra 1-in-6, Secret 1-in-12 (before:
 *   Ultra 1-in-12, Secret 1-in-23); Ghost Rares were 1-in-288; Ultimate and Ghost leave boosters
 *   after Dimension of Chaos; the 2010 change raised Secret odds.
 * - Yugipedia "Core Booster" (TCG table): slot layout per era — LOB–LODT 8 Commons + 1 other
 *   (Rare otherwise); TDGS–DOCS 7 Commons + 1 Rare + 1 other (Common otherwise); BOSH–IGAS
 *   7 Commons + 1 Rare + 1 foil; ETCO onward 8 Commons + 1 foil.
 * - Yugipedia rarity pages: "Secret Rare" (1:31 before The Shining Darkness, 1:23 after, 1:12 from
 *   BOSH), "Ultra Rare" (1:12 before SOD, 1:24 from SOD, back to 1:12 from TAEV — also on the TAEV
 *   page), "Short Print" (about 1 per 3 packs), "Super Rare" (1:5 pre-2016).
 *
 * Conflicts and judgement calls:
 * - Secret Rare before 2010: the Core Booster table says 1/24, the Secret Rare page says 1:31. Konami
 *   itself says the 2010 change raised Secret odds to 1-in-23, which rules out a flat 1/24 before it,
 *   so we use 1:31 up to Absolute Powerforce and 1:23 from The Shining Darkness.
 * - Super Rare before 2016: the Core Booster table says 1/4 for every era; the Super Rare page says
 *   1:5 for Duelist Alliance. We use 1:5 where the page speaks (TDGS–DOCS) and the table's 1/4 for
 *   2002–2008, the only figure for those years.
 * - Ultimate Rare: no official rate. The widely repeated figure is about one per box (1:24); one
 *   forum list says 1:48. We use 1:24.
 * - Starlight and Quarter Century Secret Rare: Konami publishes no rate. Community estimates run from
 *   roughly 1:72 to 1:600 packs on small samples. We give each set's single chase foil the one
 *   documented chase rate, Konami's 1-in-288 for Ghost Rares, which Starlights took over from.
 * - Super Short Print: Kevin Tewart has said no such separate rarity exists, so SSPs get roughly the
 *   same per-card rate as Short Prints (early sets list about five times as many SPs as SSPs).
 *
 * Each pack is rolled on its own: no box guarantees. Rarity strings are YGOPRODeck set_rarity values;
 * rolling matches printings by base rarity, so "Ultra Rare (Overframe)" counts as an Ultra Rare.
 */

/** A slot of `count` cards that are always `rarity`. */
const fixed = (rarity: string, count = 1): PackSlot => ({ count, picks: [{ rarity, weight: 1 }] })

/**
 * One slot that is `base` unless it rolls one of `odds` (per-pack chances). The base pick gets the
 * leftover chance, so weights add up to 1.
 */
function oneOf(base: string, odds: Record<string, number>): PackSlot {
  const rest: SlotPick[] = Object.entries(odds).map(([rarity, weight]) => ({ rarity, weight }))
  const used = rest.reduce((sum, p) => sum + p.weight, 0)
  return { count: 1, picks: [{ rarity: base, weight: 1 - used }, ...rest] }
}

/** About 1 pack in 3 holds a Short Print, taking one Common's place. */
const SHORT_PRINT = { 'Short Print': 1 / 3 }
/** Early sets also have Super Short Prints; same per-card rate as SPs (see header). */
const SHORT_PRINTS_EARLY = { 'Short Print': 1 / 3, 'Super Short Print': 1 / 15 }
/** Konami's documented 1-in-288 chase rate (Ghost Rare), reused for Starlight and QCSR. */
const CHASE = 1 / 288

const KONAMI_2016 =
  'Konami, "Booster Pack Changes in 2016" (yugiohblog.konami.com/articles/?p=7413, 2015)'
const CORE_TABLE = 'Yugipedia "Core Booster" TCG rarity table'

const layouts: PackLayout[] = [
  {
    id: 'core-2002',
    label: 'Core Booster (2002–2004)',
    source: `${CORE_TABLE} (LOB–LODT: 8 Commons + 1 other); Yugipedia "Secret Rare" (1:31 pre-2010), "Ultra Rare" (1:12 before SOD), "Short Print" (~1:3)`,
    slots: [
      fixed('Common', 7),
      oneOf('Common', SHORT_PRINTS_EARLY),
      oneOf('Rare', { 'Super Rare': 1 / 4, 'Ultra Rare': 1 / 12, 'Secret Rare': 1 / 31 })
    ]
  },
  {
    id: 'core-2004',
    label: 'Core Booster (2004–2007)',
    source: `${CORE_TABLE} (8 Commons + 1 other); Yugipedia "Ultra Rare" (1:24 from SOD to TAEV), "Secret Rare" (1:31); Ultimate ~1:24 (community)`,
    slots: [
      fixed('Common', 7),
      oneOf('Common', SHORT_PRINT),
      oneOf('Rare', {
        'Super Rare': 1 / 4,
        'Ultra Rare': 1 / 24,
        'Ultimate Rare': 1 / 24,
        'Secret Rare': 1 / 31
      })
    ]
  },
  {
    id: 'core-2007',
    label: 'Core Booster (2007–2008)',
    source: `${CORE_TABLE} (8 Commons + 1 other); Yugipedia "Tactical Evolution"/"Ultra Rare" (Ultra back to 1:12); ${KONAMI_2016} (Ghost 1:288); Ultimate ~1:24 (community)`,
    slots: [
      fixed('Common', 7),
      oneOf('Common', SHORT_PRINT),
      oneOf('Rare', {
        'Super Rare': 1 / 4,
        'Ultra Rare': 1 / 12,
        'Ultimate Rare': 1 / 24,
        'Secret Rare': 1 / 31,
        'Ghost Rare': CHASE
      })
    ]
  },
  {
    id: 'core-2008',
    label: 'Core Booster (2008–2010)',
    source: `${CORE_TABLE} (TDGS–DOCS: 7 Commons + 1 Rare + 1 other); Yugipedia "Super Rare" (1:5), "Secret Rare" (1:31 before TSHD); ${KONAMI_2016} (Ultra 1:12, Ghost 1:288); Ultimate ~1:24 (community)`,
    slots: [
      fixed('Common', 6),
      oneOf('Common', SHORT_PRINT),
      fixed('Rare'),
      oneOf('Common', {
        'Super Rare': 1 / 5,
        'Ultra Rare': 1 / 12,
        'Ultimate Rare': 1 / 24,
        'Secret Rare': 1 / 31,
        'Ghost Rare': CHASE
      })
    ]
  },
  {
    id: 'core-2010',
    label: 'Core Booster (2010–2015)',
    source: `${CORE_TABLE} (TDGS–DOCS: 7 Commons + 1 Rare + 1 other); ${KONAMI_2016} (Ultra 1:12, Secret 1:23 after the 2010 change, Ghost 1:288); Yugipedia "Super Rare" (1:5); Ultimate ~1:24 (community)`,
    slots: [
      fixed('Common', 6),
      oneOf('Common', SHORT_PRINT),
      fixed('Rare'),
      oneOf('Common', {
        'Super Rare': 1 / 5,
        'Ultra Rare': 1 / 12,
        'Ultimate Rare': 1 / 24,
        'Secret Rare': 1 / 23,
        'Ghost Rare': CHASE
      })
    ]
  },
  {
    id: 'core-2016',
    label: 'Core Booster (2016–2020)',
    source: `${KONAMI_2016}: 7 Commons + 1 Rare + 1 foil; per 24 packs 18 Super, 4 Ultra, 2 Secret. Starlight (RIRA–IGAS) at the 1:288 chase rate (no official figure)`,
    slots: [
      fixed('Common', 6),
      oneOf('Common', SHORT_PRINT),
      fixed('Rare'),
      oneOf('Super Rare', { 'Ultra Rare': 1 / 6, 'Secret Rare': 1 / 12, 'Starlight Rare': CHASE })
    ]
  },
  {
    id: 'core-2020',
    label: 'Core Booster (2020–2023)',
    source: `${CORE_TABLE} (ETCO onward: 8 Commons + 1 foil, Rares retired); ${KONAMI_2016} (Ultra 1:6, Secret 1:12); Starlight at the 1:288 chase rate (no official figure)`,
    slots: [
      fixed('Common', 8),
      oneOf('Super Rare', { 'Ultra Rare': 1 / 6, 'Secret Rare': 1 / 12, 'Starlight Rare': CHASE })
    ]
  },
  {
    id: 'core-2023',
    label: 'Core Booster (25th anniversary, 2023–2025)',
    source: `${CORE_TABLE} (8 Commons + 1 foil); ${KONAMI_2016} (Ultra 1:6, Secret 1:12); Quarter Century Secret at the 1:288 chase rate (no official figure)`,
    slots: [
      fixed('Common', 8),
      oneOf('Super Rare', {
        'Ultra Rare': 1 / 6,
        'Secret Rare': 1 / 12,
        'Quarter Century Secret Rare': CHASE
      })
    ]
  },
  {
    id: 'core-2025',
    label: 'Core Booster (2025–)',
    source: `${CORE_TABLE} (8 Commons + 1 foil); ${KONAMI_2016} (Ultra 1:6, Secret 1:12); Yugipedia "Starlight Rare" (back from Duelist's Advance) at the 1:288 chase rate (no official figure)`,
    slots: [
      fixed('Common', 8),
      oneOf('Super Rare', { 'Ultra Rare': 1 / 6, 'Secret Rare': 1 / 12, 'Starlight Rare': CHASE })
    ]
  }
]

export const RIP_LAYOUTS: Record<string, PackLayout> = Object.fromEntries(
  layouts.map((l) => [l.id, l])
)

/** Set code prefixes per layout (space-separated), oldest first. */
const SETS_BY_LAYOUT: Record<string, string> = {
  // Magic Ruler (MRL) and its later name Spell Ruler (SRL) are the same set.
  'core-2002': 'LOB MRD MRL SRL PSV LON LOD PGD MFC DCR IOC AST',
  'core-2004': 'SOD RDS FET TLM CRV EEN SOI EOJ POTD CDIP STON FOTB',
  'core-2007': 'TAEV GLAS PTDN LODT',
  'core-2008': 'TDGS CSOC CRMS RGBT ANPR SOVR ABPF',
  'core-2010':
    'TSHD DREV STBL STOR EXVC GENF PHSW ORCS GAOV REDU ABYR CBLZ LTGY JOTL SHSP LVAL PRIO DUEA NECH SECE CROS CORE DOCS',
  // High-Speed Riders (HSRD) previewed the 2016 format, per Konami's 2015 announcement.
  'core-2016':
    'HSRD BOSH SHVI TDIL INOV RATE MACR COTD CIBR EXFO FLOD CYHO SOFU SAST DANE RIRA CHIM IGAS',
  'core-2020': 'ETCO ROTD PHRA BLVO LIOV DAMA BODE BACH DIFO POTE DABL PHHY CYAC',
  'core-2023': 'DUNE AGOV PHNI LEDE INFO ROTA SUDA ALIN',
  'core-2025': 'DUAD DOOD BPRO BLZD CORI BETB'
}

/** Set code prefix (e.g. "LOB") → layout id. */
export const RIP_SET_LAYOUTS: Record<string, string> = Object.fromEntries(
  Object.entries(SETS_BY_LAYOUT).flatMap(([id, codes]) =>
    codes.split(' ').map((code) => [code, id])
  )
)

/**
 * The researched layout for a set, or null. Takes a set code prefix ("LOB") or a card code
 * ("LOB-EN001"); `map` lets tests register their own set codes.
 */
export function layoutFor(
  setCode: string,
  map: Record<string, string> = RIP_SET_LAYOUTS
): PackLayout | null {
  const prefix = setCode.split('-')[0].trim().toUpperCase()
  const id = Object.hasOwn(map, prefix) ? map[prefix] : undefined
  return id !== undefined && Object.hasOwn(RIP_LAYOUTS, id) ? RIP_LAYOUTS[id] : null
}
