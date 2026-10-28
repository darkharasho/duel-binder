import { baseOf, revealTier, ripRank } from './rarity'
import type { PackLayout, PackSlot, RevealTier, SlotPick } from './types'

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
 * - Super Short Print: Kevin Tewart has said no such separate rarity exists, and nothing documents a
 *   rate. Collectors treat SSPs as scarcer, so the SSP weight is kept low enough that one SSP card is
 *   never likelier than one SP card in any early set in the catalog. The worst case is AST, with
 *   21 SP cards and 1 SSP: (1/3) / 21 ≈ 0.016 per SP card against 1/72 ≈ 0.014 for its SSP.
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
/** Early sets also have Super Short Prints: about 1 pack in 72, never likelier per card than an SP. */
const SHORT_PRINTS_EARLY = { 'Short Print': 1 / 3, 'Super Short Print': 1 / 72 }
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

/*
 * The Rarity Collections and Quarter Century sets: all-foil packs where every
 * card in the set comes in every rarity.
 *
 * Sources: Konami's product pages (yugioh-card.com/en/products/ra01/ and /ra02/,
 * yugioh-card.com/eu/product/quarter-century-bonanza/), checked October 2026:
 * - RA01: 5 cards — 2 Super; 1 Secret with a 1-in-4 chance of being Platinum or Quarter Century
 *   Secret; 2 Ultra, each with a 1-in-6 chance of being a "Prismatic" Collector's or Ultimate Rare.
 * - RA02: 9 cards — 3 Super, 2 Secret, 4 Ultra, with the same upgrade chances per card.
 * - RA03: RA01's pack with one Super replaced by a guaranteed Platinum or Quarter Century Secret
 *   from a separate pool of older cards (RA03-EN079 on, printed only in those two rarities); the
 *   other slots draw from the 78-card main set.
 * - RA04 (Quarter Century Stampede): RA03's pack again, from a 105-card main set, with the older
 *   cards from RA04-EN106 on. Konami's own page is gone; retailer and news copies of the
 *   announcement (e.g. yugiohmeta.com, Dec 2024) give the makeup.
 * - RA05 (Rarity Collection 5, yugioh-card.com/eu/product/rarity-collection-5/): 1 Super, 1 Secret
 *   with a 1-in-4 chance of being Platinum or Starlight, 2 Ultra as before, all from the 82-card
 *   main set; then a 5th card, "always Ultra or Starlight", from 68 new variant arts (RA05-EN083 on).
 * Judgement calls: Konami doesn't say how an upgrade splits between its two rarities; we split it
 * evenly. Nor does it give a Starlight rate for RA05's 5th card; we use 1 in 8, a Secret's chance
 * of turning Starlight. In these sets Super and Ultra are the floor, so they reveal like Commons,
 * and a Secret like a Rare.
 */
const RA_SOURCE = 'Konami product pages for RA01, RA02 and Quarter Century Bonanza'
const RA_SOURCE_LATER =
  'Konami EU product page for Rarity Collection 5; retailer and news copies of the Quarter Century Stampede announcement'
const RA_TIERS: Partial<Record<string, RevealTier>> = {
  'Super Rare': 'none',
  'Ultra Rare': 'none',
  'Secret Rare': 'rare'
}
const RA_SECRET = { 'Platinum Secret Rare': 1 / 8, 'Quarter Century Secret Rare': 1 / 8 }
const RA_ULTRA = { "Collector's Rare": 1 / 12, 'Ultimate Rare': 1 / 12 }
/** RA03's main set, and its pool of older cards in Platinum or Quarter Century only. */
const RA03_MAIN = { from: 1, to: 78 }
const RA03_NOSTALGIA = { from: 79 }
/** RA04 is RA03 again, with a 105-card main set. */
const RA04_MAIN = { from: 1, to: 105 }
const RA04_NOSTALGIA = { from: 106 }
/** RA05's main set, and its pool of new variant arts (Ultra or Starlight only) for the 5th card. */
const RA05_MAIN = { from: 1, to: 82 }
const RA05_VARIANTS = { from: 83 }
/** The 4 cards from a Quarter Century set's main pool, then its guaranteed older card. */
const quarterCentury = (main: PackSlot['numbers'], nostalgia: PackSlot['numbers']): PackSlot[] => [
  { ...fixed('Super Rare'), numbers: main },
  { ...oneOf('Secret Rare', RA_SECRET), numbers: main },
  { ...oneOf('Ultra Rare', RA_ULTRA), count: 2, numbers: main },
  {
    ...oneOf('Platinum Secret Rare', { 'Quarter Century Secret Rare': 1 / 2 }),
    numbers: nostalgia
  }
]

layouts.push(
  {
    id: 'rarity-collection',
    label: '25th Anniversary Rarity Collection',
    source: `${RA_SOURCE}: 2 Super, 1 Secret (1 in 4 Platinum or QCSR), 2 Ultra (1 in 6 each Collector's or Ultimate); upgrades split evenly (no official split)`,
    tiers: RA_TIERS,
    slots: [
      fixed('Super Rare', 2),
      oneOf('Secret Rare', RA_SECRET),
      { ...oneOf('Ultra Rare', RA_ULTRA), count: 2 }
    ]
  },
  {
    id: 'rarity-collection-2',
    label: '25th Anniversary Rarity Collection II',
    source: `${RA_SOURCE}: 3 Super, 2 Secret (1 in 4 each Platinum or QCSR), 4 Ultra (1 in 6 each Collector's or Ultimate); upgrades split evenly (no official split)`,
    tiers: RA_TIERS,
    slots: [
      fixed('Super Rare', 3),
      { ...oneOf('Secret Rare', RA_SECRET), count: 2 },
      { ...oneOf('Ultra Rare', RA_ULTRA), count: 4 }
    ]
  },
  {
    id: 'quarter-century-bonanza',
    label: 'Quarter Century Bonanza',
    source: `${RA_SOURCE}: RA01's pack with one Super swapped for a guaranteed Platinum or QCSR from the older-card pool (RA03-EN079 on); upgrades split evenly (no official split)`,
    tiers: RA_TIERS,
    slots: quarterCentury(RA03_MAIN, RA03_NOSTALGIA)
  },
  {
    id: 'quarter-century-stampede',
    label: 'Quarter Century Stampede',
    source: `${RA_SOURCE_LATER}: Quarter Century Bonanza's pack, from a 105-card main set, with the guaranteed card from the older-card pool (RA04-EN106 on); upgrades split evenly (no official split)`,
    tiers: RA_TIERS,
    slots: quarterCentury(RA04_MAIN, RA04_NOSTALGIA)
  },
  {
    id: 'rarity-collection-5',
    label: 'Rarity Collection 5',
    source: `${RA_SOURCE_LATER}: 1 Super, 1 Secret (1 in 4 Platinum or Starlight), 2 Ultra (1 in 6 each Collector's or Ultimate) from the first 82, then 1 Ultra or Starlight from the variant-art pool (RA05-EN083 on). Konami gives no rate for a Starlight in the variant slot; we use 1 in 8, a Secret's chance of turning Starlight. Upgrades split evenly (no official split)`,
    tiers: RA_TIERS,
    slots: [
      { ...fixed('Super Rare'), numbers: RA05_MAIN },
      {
        ...oneOf('Secret Rare', { 'Platinum Secret Rare': 1 / 8, 'Starlight Rare': 1 / 8 }),
        numbers: RA05_MAIN
      },
      { ...oneOf('Ultra Rare', RA_ULTRA), count: 2, numbers: RA05_MAIN },
      { ...oneOf('Ultra Rare', { 'Starlight Rare': 1 / 8 }), numbers: RA05_VARIANTS }
    ]
  }
)

/*
 * Battles of Legend: 5-card all-foil packs, 1 Secret and 4 Ultra, every set from Light's Revenge
 * (2017) on. Chapter 1 is a boxed set, not booster packs, so it has no layout.
 *
 * Sources: Konami product pages (yugioh-card.com/eu/product/battles-of-legend-monstrous-revenge/,
 * …-monster-mayhem/, …-glorious-gallery/), checked October 2026, and retailer copies of the older
 * announcements, which all give the same 1 Secret + 4 Ultra:
 * - Monster Mayhem: "1 Secret Rare, 1 emblazoned Ultra Rare (always a Dragonmaid, P.U.N.K., or
 *   Orcust-themed card), 3 other Ultra Rares". The emblazoned cards are BLMM-EN048 to EN098 (51,
 *   as Konami counts them); the other Ultras are all numbered after them.
 * - Chase foils: Starlight (Armageddon's Number 39: Utopia, Crystal Revenge, Monster Mayhem,
 *   Glorious Gallery), Quarter Century Secret (Monstrous and Terminal Revenge) and Armageddon's
 *   10000 Secret Ten Thousand Dragon. Konami gives no rate; for Monster Mayhem it says Starlights
 *   come "at about the same rate" as Quarter Century Secrets had. We use the 1-in-288 chase rate
 *   for each, as for the Core Boosters.
 * Judgement call: Konami doesn't say which card a chase foil replaces; we put it in the Secret's
 * place. As in the Rarity Collections, Ultra is the floor and reveals like a Common, a Secret like
 * a Rare.
 */
const BL_SOURCE =
  "Konami product pages for Monstrous Revenge, Monster Mayhem and Glorious Gallery; retailer copies of the earlier sets' announcements"
/** 1 Secret, which can turn into one of `chase`, and 4 Ultra. */
const battlesOfLegend = (chase: Record<string, number> = {}): PackSlot[] => [
  oneOf('Secret Rare', chase),
  fixed('Ultra Rare', 4)
]
/** Monster Mayhem's emblazoned Dragonmaid, P.U.N.K. and Orcust Ultras, and the Ultras after them. */
const BLMM_EMBLAZONED = { from: 48, to: 98 }
const BLMM_OTHER_ULTRA = { from: 99 }

layouts.push(
  {
    id: 'battles-of-legend',
    label: 'Battles of Legend',
    source: `${BL_SOURCE}: 1 Secret + 4 Ultra`,
    tiers: RA_TIERS,
    slots: battlesOfLegend()
  },
  {
    id: 'battles-of-legend-armageddon',
    label: 'Battles of Legend: Armageddon',
    source: `${BL_SOURCE}: 1 Secret + 4 Ultra; the Starlight Utopia and the 10000 Secret Ten Thousand Dragon each at the 1:288 chase rate (no official figure)`,
    tiers: RA_TIERS,
    slots: battlesOfLegend({ 'Starlight Rare': CHASE, '10000 Secret Rare': CHASE })
  },
  {
    id: 'battles-of-legend-starlight',
    label: 'Battles of Legend (Starlight)',
    source: `${BL_SOURCE}: 1 Secret + 4 Ultra; Starlight at the 1:288 chase rate (no official figure)`,
    tiers: RA_TIERS,
    slots: battlesOfLegend({ 'Starlight Rare': CHASE })
  },
  {
    id: 'battles-of-legend-quarter-century',
    label: 'Battles of Legend (Quarter Century)',
    source: `${BL_SOURCE}: 1 Secret + 4 Ultra; Quarter Century Secret at the 1:288 chase rate (no official figure)`,
    tiers: RA_TIERS,
    slots: battlesOfLegend({ 'Quarter Century Secret Rare': CHASE })
  },
  {
    id: 'battles-of-legend-monster-mayhem',
    label: 'Battles of Legend: Monster Mayhem',
    source: `${BL_SOURCE}: 1 Secret, 1 emblazoned Ultra (BLMM-EN048 to EN098), 3 other Ultra; Starlight at the 1:288 chase rate (no official figure)`,
    tiers: RA_TIERS,
    slots: [
      oneOf('Secret Rare', { 'Starlight Rare': CHASE }),
      { ...fixed('Ultra Rare'), numbers: BLMM_EMBLAZONED },
      { ...fixed('Ultra Rare', 3), numbers: BLMM_OTHER_ULTRA }
    ]
  }
)

/*
 * Legendary Duelists (LEDU, LED2–LED9, LD10). Konami's product pages and Yugipedia give only
 * "5 cards per pack" and the set totals (about 30 Commons, 10 Rares, 8 Super, 9 Ultra). No source
 * spells out the slots, so this is a judgement call: 10 Rares and ~17 foils in every set mean each
 * pack holds a Rare and a foil, which leaves 3 Commons. Ultra takes the foil slot 1 in 3, the
 * 12 Ultras a box that openings report. LED7–LD10 have one Ghost Rare, at Konami's 1:288; sets
 * without one fold that chance into the Super.
 * The Season 1–3 sets (LDS1–LDS3) are boxed collections of 18-card packs, so they get no layout.
 */
layouts.push({
  id: 'legendary-duelists',
  label: 'Legendary Duelists',
  source:
    'Konami product pages and Yugipedia (5 cards per pack, set totals only); 3 Commons + 1 Rare + 1 Super, Ultra 1 in 3 (inferred, no official split); Ghost Rare at the 1:288 chase rate',
  slots: [
    fixed('Common', 3),
    fixed('Rare'),
    oneOf('Super Rare', { 'Ultra Rare': 1 / 3, 'Ghost Rare': CHASE })
  ]
})

/*
 * Duelist Packs (DP1–DP11, DPYG, DPKB, DPBC, DPRP, DPDG). Konami's product pages for Duelist
 * Pack: Yugi and Duelist Pack: Kaiba (archived) give the split: 4 Commons (4:1) and a Rare (1:1),
 * with Super 1:5, Ultra 1:15 and, in Kaiba, Ultimate 1:24. The other packs from DP1 to Crow have
 * the same 30-card mix; Battle City, Rivals of the Pharaoh and Dimensional Guardians (2015–2017)
 * keep 5 cards a pack but no rate survives, so they reuse Konami's figures. Yugipedia's "Ultra
 * Rare" page gives 1:6 for Duelist Packs without a source; Konami's own 1:15 wins. Packs without
 * Ultimates fold that chance into the Rare. The Duelist Pack Collection Tins and DPK aren't packs.
 */
layouts.push({
  id: 'duelist-pack',
  label: 'Duelist Pack',
  source:
    'Konami product pages for Duelist Pack: Yugi and Kaiba (archived): 4 Commons + 1 Rare; Super 1:5, Ultra 1:15, Ultimate 1:24 (Kaiba). Later packs reuse these (no official figure)',
  slots: [
    fixed('Common', 4),
    oneOf('Rare', { 'Super Rare': 1 / 5, 'Ultra Rare': 1 / 15, 'Ultimate Rare': 1 / 24 })
  ]
})

/*
 * The Gold Series line. Yugipedia's set pages (checked October 2026) give every pack's contents:
 * - Gold Series (GLD1) to Gold Series 4: Pyramids Edition: 25 cards a pack, 22 Commons and 3 Gold
 *   Rares (GLD1's page gives only the 25; with 18 Gold Rares and 27 Commons it matches the rest).
 * - Gold Series: Haunted Mine: 22 Commons, 2 Gold Rares and 1 Ghost/Gold Rare.
 * - Premium Gold (North American 5-card mini-packs; other regions sold one 15-card pack):
 *   2 Gold Secrets (001–032), 1 Gold Rare new to gold (033–050), 2 Gold Rare reprints (051 on).
 * - Premium Gold: Return of the Bling (US mini-packs): 2 Gold Secrets (001–021), 2 Gold Rares new
 *   to gold (022–069), 1 reprint from the earlier Gold Series (070 on).
 * - Premium Gold: Infinite Gold: 2 Gold Secrets and 3 Gold Rares.
 * - Maximum Gold and Maximum Gold: El Dorado: 7 cards a pack, 2 Premium Gold Rares and 5
 *   gold-letter Rares.
 * Every slot is fixed, so there are no odds to judge. The scarcer gold in each product reveals like
 * a Rare and its floor like a Common; Haunted Mine's Ghost/Gold is its one big hit.
 */
const GOLD_SOURCE = 'Yugipedia set pages for the Gold Series, Premium Gold and Maximum Gold sets'
const PREMIUM_GOLD_TIERS: Partial<Record<string, RevealTier>> = {
  'Gold Rare': 'none',
  'Gold Secret Rare': 'rare'
}
/** 22 Commons and 3 golds, the last of which can be `last`. */
const goldSeries = (last: string): PackSlot[] => [
  fixed('Common', 22),
  fixed('Gold Rare', last === 'Gold Rare' ? 3 : 2),
  ...(last === 'Gold Rare' ? [] : [fixed(last)])
]

layouts.push(
  {
    id: 'gold-series',
    label: 'Gold Series',
    source: `${GOLD_SOURCE}: 22 Commons + 3 Gold Rares`,
    tiers: { 'Gold Rare': 'rare' },
    slots: goldSeries('Gold Rare')
  },
  {
    id: 'gold-series-haunted-mine',
    label: 'Gold Series: Haunted Mine',
    source: `${GOLD_SOURCE}: 22 Commons + 2 Gold Rares + 1 Ghost/Gold Rare`,
    tiers: { 'Gold Rare': 'rare', 'Ghost/Gold Rare': 'big' },
    slots: goldSeries('Ghost/Gold Rare')
  },
  {
    id: 'premium-gold',
    label: 'Premium Gold',
    source: `${GOLD_SOURCE}: 1 Gold Rare new to gold (033–050), 2 Gold Rare reprints (051 on), 2 Gold Secrets (North American mini-pack)`,
    tiers: PREMIUM_GOLD_TIERS,
    slots: [
      { ...fixed('Gold Rare'), numbers: { from: 33, to: 50 } },
      { ...fixed('Gold Rare', 2), numbers: { from: 51 } },
      fixed('Gold Secret Rare', 2)
    ]
  },
  {
    id: 'premium-gold-return-of-the-bling',
    label: 'Premium Gold: Return of the Bling',
    source: `${GOLD_SOURCE}: 2 Gold Rares new to gold (022–069), 1 Gold Series reprint (070 on), 2 Gold Secrets (US mini-pack)`,
    tiers: PREMIUM_GOLD_TIERS,
    slots: [
      { ...fixed('Gold Rare', 2), numbers: { from: 22, to: 69 } },
      { ...fixed('Gold Rare'), numbers: { from: 70 } },
      fixed('Gold Secret Rare', 2)
    ]
  },
  {
    id: 'premium-gold-infinite-gold',
    label: 'Premium Gold: Infinite Gold',
    source: `${GOLD_SOURCE}: 3 Gold Rares + 2 Gold Secrets`,
    tiers: PREMIUM_GOLD_TIERS,
    slots: [fixed('Gold Rare', 3), fixed('Gold Secret Rare', 2)]
  },
  {
    id: 'maximum-gold',
    label: 'Maximum Gold',
    source: `${GOLD_SOURCE}: 5 Rares + 2 Premium Gold Rares`,
    tiers: { Rare: 'none', 'Premium Gold Rare': 'rare' },
    slots: [fixed('Rare', 5), fixed('Premium Gold Rare', 2)]
  }
)

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
  'core-2025': 'DUAD DOOD BPRO BLZD CORI BETB',
  'rarity-collection': 'RA01',
  'rarity-collection-2': 'RA02',
  'quarter-century-bonanza': 'RA03',
  'quarter-century-stampede': 'RA04',
  'rarity-collection-5': 'RA05',
  'battles-of-legend': 'BLLR BLRR BLHR',
  'battles-of-legend-armageddon': 'BLAR',
  'battles-of-legend-starlight': 'BLCR BLGG',
  'battles-of-legend-quarter-century': 'BLMR BLTR',
  'battles-of-legend-monster-mayhem': 'BLMM',
  'legendary-duelists': 'LEDU LED2 LED3 LED4 LED5 LED6 LED7 LED8 LED9 LD10',
  'duelist-pack': 'DP1 DP2 DP03 DP04 DP05 DP06 DP07 DP08 DP09 DP10 DP11 DPYG DPKB DPBC DPRP DPDG',
  'gold-series': 'GLD1 GLD2 GLD3 GLD4',
  'gold-series-haunted-mine': 'GLD5',
  'premium-gold': 'PGLD',
  'premium-gold-return-of-the-bling': 'PGL2',
  'premium-gold-infinite-gold': 'PGL3',
  'maximum-gold': 'MAGO MGED'
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

/**
 * How big a reveal a card gets: its rarity's usual tier, unless its set's layout says otherwise
 * (a Super Rare is the floor of an all-foil set). `setCode` may be a prefix or a card code.
 */
export function tierFor(rarity: string, setCode?: string | null): RevealTier {
  const own = setCode ? layoutFor(setCode)?.tiers?.[baseOf(rarity)] : undefined
  return own ?? revealTier(rarity)
}

/** "Super Rare" → "Super"; plain "Rare" stays. */
const shortRarity = (r: string): string => r.replace(/(.) Rare$/, '$1')

/**
 * A short line about what's in a pack, read off the slots: "9 cards a pack · 1 Rare + 1 Super or
 * better". Commons and Short Prints aren't listed; a Common slot that can upgrade is "1 slot that
 * can hit Super or better". Neighbouring slots that read the same are counted together.
 */
export function describeLayout(layout: PackLayout): string {
  const total = layout.slots.reduce((n, s) => n + s.count, 0)
  const rare = ripRank('Rare')
  /** Each listed slot as a count and the words after it; neighbours with the same words merge. */
  const parts: { count: number; text: string }[] = []
  const add = (count: number, text: string): void => {
    const last = parts[parts.length - 1]
    if (last?.text === text) last.count += count
    else parts.push({ count, text })
  }
  for (const slot of layout.slots) {
    const ranked = [...slot.picks].sort((a, b) => ripRank(a.rarity) - ripRank(b.rarity))
    const floor = ranked[0].rarity
    if (ripRank(floor) >= rare) {
      add(
        slot.count,
        slot.picks.length === 1 ? shortRarity(floor) : `${shortRarity(floor)} or better`
      )
    } else {
      const up = ranked.find((p) => ripRank(p.rarity) >= rare)
      if (up) add(slot.count, `slot that can hit ${shortRarity(up.rarity)} or better`)
    }
  }
  const listed = parts.map((p) => `${p.count} ${p.text}`).join(' + ')
  return [`${total} cards a pack`, listed].filter(Boolean).join(' · ')
}
