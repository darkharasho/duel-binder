// The cards the home page shows off: the hero binder's two spreads, each game's fan, the scanner
// demo, the set checklist and the device screens. Ids are portal image ids (/img/small/<id>);
// prices are examples for the page, not live ones.

export interface ShowCard {
  id: string
  name: string
  code: string
  price: string
}

const c = (id: string, name: string, code: string, price: string): ShowCard => ({
  id,
  name,
  code,
  price
})

/** The hero binder: nine pockets a page. left/right show first; right2 is under the right page and left2 on its back. */
export const BINDER = {
  left: [
    c('46986414', 'Dark Magician', 'LOB-005', '$14.20'),
    c('74677422', 'Red-Eyes Black Dragon', 'LOB-070', '$18.50'),
    c('55144522', 'Pot of Greed', 'LOB-119', '$6.10'),
    c('70781052', 'Summoned Skull', 'MRD-003', '$5.40'),
    c('89631139', 'Blue-Eyes White Dragon', 'LOB-001', '$42.00'),
    c('44095762', 'Mirror Force', 'MRD-138', '$22.80'),
    c('10000020', 'Slifer the Sky Dragon', 'GBI-001', '$9.40'),
    c('40640057', 'Kuriboh', 'MRD-071', '$3.20'),
    c('10000000', 'Obelisk the Tormentor', 'GBI-002', '$8.70')
  ],
  right: [
    c('49556840451670', 'Charizard ex', 'OBF 125/197', '$38.90'),
    c('552503209712', 'Monkey.D.Luffy', 'OP01-024', '$4.80'),
    c('995260625615027', 'Umbreon VMAX', 'EVS 215/203', '$1,180'),
    c('121773722391840', 'Mew ex', 'MEW 151/165', '$12.80'),
    c('38033121', 'Dark Magician Girl', 'MFC-000', '$21.40'),
    c('232602764113106', 'Lugia V', 'SIT 186/195', '$96.00'),
    c('275128721932', 'Counterspell', '2X2 117', '$1.40'),
    c('553840774705', 'Portgas.D.Ace', 'OP02-013', '$9.60'),
    c('282055353051', 'Black Lotus', 'LEA 232', '$28,500')
  ],
  // after the page turns: Exodia put together on the left, the Sacred Beasts and staples on the right
  left2: [
    c('70903634', 'Right Arm of the Forbidden One', 'LOB-122', '$7.90'),
    c('33396948', 'Exodia the Forbidden One', 'LOB-124', '$48.00'),
    c('7902349', 'Left Arm of the Forbidden One', 'LOB-123', '$7.60'),
    c('8124921', 'Right Leg of the Forbidden One', 'LOB-120', '$6.80'),
    c('26202165', 'Sangan', 'MRD-069', '$2.10'),
    c('44519536', 'Left Leg of the Forbidden One', 'LOB-121', '$6.90'),
    c('12580477', 'Raigeki', 'LOB-053', '$11.30'),
    c('53129443', 'Dark Hole', 'LOB-052', '$4.50'),
    c('4031928', 'Change of Heart', 'MRD-060', '$5.20')
  ],
  right2: [
    c('6007213', 'Uria, Lord of Searing Flames', 'PTDN-EN001', '$3.80'),
    c('32491822', 'Hamon, Lord of Striking Thunder', 'SOVR-EN001', '$4.10'),
    c('69890967', 'Raviel, Lord of Phantasms', 'FOTB-EN001', '$5.30'),
    c('6368038', 'Gaia The Fierce Knight', 'LOB-006', '$2.90'),
    c('72989439', 'Black Luster Soldier - Envoy of the Beginning', 'IOC-025', '$11.90'),
    c('44508094', 'Stardust Dragon', 'TDGS-EN040', '$16.70'),
    c('14558127', 'Ash Blossom & Joyous Spring', 'MACR-EN036', '$4.40'),
    c('23434538', 'Maxx "C"', 'RA01-EN008', '$3.10'),
    c('27204311', 'Nibiru, the Primal Being', 'TN19-EN013', '$2.60')
  ]
}

/** The wash once the page has turned (its card is in the middle of the new right page). */
export const TURNED_WASH = 'Black Luster Soldier'

/** Three cards fanned out beside each game, and the wash the page takes while it's in view. */
export const FANS: Record<
  'ygo' | 'pkm' | 'mtg' | 'op',
  { wash: string; codes: string; ids: string[] }
> = {
  ygo: {
    wash: 'Blue-Eyes White Dragon',
    codes: 'LOB-001  SDK-001  MVP1-JP004',
    ids: ['46986414', '89631139', '38033121']
  },
  pkm: {
    wash: 'Charizard ex',
    codes: 'OBF 125/197  EVS 215/203  MEW 151/165',
    ids: ['995260625615027', '49556840451670', '121773722391840']
  },
  mtg: {
    wash: 'Counterspell',
    codes: '2X2 117  M10 146  LEA 232',
    ids: ['279332584578', '275128721932', '282055353051']
  },
  op: {
    wash: 'Monkey.D.Luffy',
    codes: 'OP01-024  OP02-013  ST01-001',
    ids: ['553840774705', '552503209712', '554606597501']
  }
}

/** The card the scanner demo reads. */
export const SCAN_CARD = {
  ...c('46986414', 'Dark Magician', 'LOB-005', '$14.20'),
  rarity: 'Ultra Rare'
}

/** The set checklist: these cards, with the ones at MISSING greyed out until tapped. */
export const SET_CARDS = [
  '46986414',
  '74677422',
  '55144522',
  '89943723',
  '44508094',
  '70095154',
  '23995346',
  '33396948',
  '72989439',
  '5405694',
  '40640057',
  '10000020',
  '44095762',
  '83764718',
  '10000000',
  '89631139',
  '38033121',
  '36996508'
]
export const SET_MISSING = [3, 7, 9, 13, 16]

/** The collection on the laptop and phone screens, and the card that syncs to all three. */
export const DEVICE_CARDS = [
  c('89631139', 'Blue-Eyes White Dragon', 'LOB-001', '$42.00'),
  c('995260625615027', 'Umbreon VMAX', 'EVS 215/203', '$1,180'),
  c('38033121', 'Dark Magician Girl', 'MFC-000', '$21.40'),
  c('232602764113106', 'Lugia V', 'SIT 186/195', '$96.00'),
  c('552503209712', 'Monkey.D.Luffy', 'OP01-024', '$4.80'),
  c('46986414', 'Dark Magician', 'LOB-005', '$14.20'),
  c('121773722391840', 'Mew ex', 'MEW 151/165', '$12.80'),
  c('275128721932', 'Counterspell', '2X2 117', '$1.40'),
  c('553840774705', 'Portgas.D.Ace', 'OP02-013', '$9.60'),
  c('279332584578', 'Shivan Dragon', '4ED 175', '$1.10'),
  c('72989439', 'Black Luster Soldier', 'IOC-025', '$11.90'),
  c('44508094', 'Stardust Dragon', 'TDGS-EN040', '$16.70')
]
export const SYNC_CARD = c('49556840451670', 'Charizard ex', 'OBF 125/197', '$38.90')
export const DEVICE_TOTAL = { before: '$15,524', after: '$15,563' }

/** A friend's binder on the web screen: two pages, '' an empty pocket, 'sync' where SYNC_CARD lands. */
export const WEB_BINDER = [
  [
    '46986414',
    '89631139',
    '38033121',
    '74677422',
    '33396948',
    '44095762',
    '10000020',
    '40640057',
    '10000000'
  ],
  [
    '995260625615027',
    '121773722391840',
    '232602764113106',
    '552503209712',
    'sync',
    '553840774705',
    '275128721932',
    '279332584578',
    ''
  ]
]
