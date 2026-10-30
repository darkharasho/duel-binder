import { describe, expect, it } from 'vitest'
import {
  pokemonLanguage,
  pokemonLanguageOfBands,
  pokemonLanguageOfReads,
  readsEnglishName,
  readsJapaneseName
} from '../../src/shared/scan/pokemonLanguage'

describe('pokemonLanguage', () => {
  it.each([
    // Kana alone may be what the Japanese model makes of noise: Japanese card words are needed.
    ['ピカチュウ HP 60 ワザ', null],
    ['ピカチュウ HP 60 ワザ 相手のバトルポケモンに10ダメージ', 'ja'],
    // As a blurred read gives them: without dakuten, spaced out, a dash read as 一.
    ['ヒ カ チ ュ ウ HP 60 相手 の ハ ト ル ホ ケ モ ン に 10 タ メ 一 シ', 'ja'],
    ['皮卡丘 HP 60 招式', 'other'],
    ['피카츄 HP 60 기술 전기', 'other'],
    // No English word in it to go on, so not told (fix round 1: English needs positive evidence).
    ['Pikachu HP 60 Gnaw', null],
    ['Pikachu HP 60 Basic Pokémon Gnaw 10 Weakness Resistance Retreat Cost', 'en'],
    [
      "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed. Discard an Energy from this Pokémon.",
      'en'
    ],
    // Read off a real photo of an English card (Grubbin): few of latinLanguageOf's words.
    ['x) dtnng shot LA\nFlip 3 coin. If ads, your opponents Acove Pokémen is\nnow Panlyzed', 'en'],
    // Read off real photos of English cards: words a blurred read gets a letter wrong.
    [') String Shot [ ip » cain. If Iveads, your oppanent’s Acove Pokémen | ow Paralyzed', 'en'],
    ['y Best Punch 4 ip a coin. If walls, his areack does nothing,', 'en'],
    ['HP', null],
    ['', null]
  ] as const)('%s reads as %s', (text, language) => {
    expect(pokemonLanguage(text)).toBe(language)
  })

  it('takes a Latin language other than English for a language not in the catalog', () => {
    expect(
      pokemonLanguage(
        'Si cette carte est dans votre main, vous pouvez la mettre sur le terrain de votre adversaire.'
      )
    ).toBe('other')
  })

  it('does not take European words a letter off English ones for English', () => {
    // Attacke, activo, energia, dommage: none counts as attack, active, energy or damage.
    expect(pokemonLanguage('Glumanda KP 60 Attacke Kratzer Energie Schaden aktiv')).not.toBe('en')
    expect(pokemonLanguage('Charmander PS 60 activo energia daño ataques')).not.toBe('en')
    expect(pokemonLanguage('Salamèche PV 60 dommage énergie attaque actif')).not.toBe('en')
  })

  it('does not take short French or German reads for English', () => {
    expect(pokemonLanguage('Pikachu PV 60 Attaque Faiblesse Résistance Retraite Éclair')).not.toBe(
      'en'
    )
    expect(pokemonLanguage('Pikachu KP 60 Basis Trainer Schwäche Resistenz Rückzug')).not.toBe('en')
  })

  it('does not count katakana that look like kanji, nor a few stray kana among Chinese', () => {
    // 口 read as ロ and the like.
    expect(pokemonLanguage('皮卡丘 HP 60 招式 电击 ロカエタトニハヘ')).toBe('other')
    expect(
      pokemonLanguage(
        '皮卡丘 HP 60 招式 电击 对手的战斗宝可梦 造成伤害 抛掷硬币 正面 麻痹 のでピュウ'
      )
    ).toBe('other')
  })

  it('does not count a dash read as a long-vowel mark for kana', () => {
    expect(pokemonLanguage('ーーーーーー HP 60')).toBeNull()
  })
})

describe('pokemonLanguageOfReads', () => {
  const EN = 'Pikachu HP 60 Basic Pokémon Gnaw 10 Weakness Resistance Retreat Cost'
  const JA = 'ピカチュウ HP 60 ワザ 相手のバトルポケモンに10ダメージ'
  const ZH = '皮卡丘 HP 60 招式'
  const FR =
    'Si cette carte est dans votre main, vous pouvez la mettre sur le terrain de votre adversaire.'
  // What one model makes of text in a script it doesn't know: says nothing.
  const GARBAGE = 'l1 ,. ii'

  it.each([
    // ja only when the jpn read says ja and the eng read doesn't say en.
    [{ jpn: JA, eng: GARBAGE }, 'ja'],
    [{ jpn: JA, eng: EN }, null],
    // en only when the eng read says en and the jpn read doesn't say ja: the jpn model's
    // kana-looking garbage on an English card never makes it Japanese.
    [{ jpn: GARBAGE, eng: EN }, 'en'],
    // other when either read says other.
    [{ jpn: ZH, eng: GARBAGE }, 'other'],
    [{ jpn: GARBAGE, eng: FR }, 'other'],
    [{ jpn: JA, eng: FR }, 'other'],
    [{ jpn: ZH, eng: EN }, 'other'],
    [{ jpn: GARBAGE, eng: GARBAGE }, null],
    [{ jpn: '', eng: '' }, null]
  ] as const)('%j → %s', (reads, expected) => {
    expect(pokemonLanguageOfReads(reads)).toBe(expected)
  })

  // Read off a real photo of an English card (Bronzong, PAL-era text box).
  const BRONZONG_ENG = [
    ') Gentle Slap 40',
    '(2) ® Metal Block 120',
    'uring your opponents next turn, this Pokémen takes',
    ')0 less damage fram arcacks from Evelution Pokémon',
    'fier opplying Weokness and Resmtonce)'
  ].join('\n')
  const BRONZONG_JPN = [
    'り Gentle 3Slap 40',
    'ウキ Metal Block 120',
    'り uring 7SUr opPonent next turm hls Pok6men takes',
    '90 less dammge rom arccks frem Evolurtien Pokemon',
    'が opPymg Weokncss an Aeggrancw)'
  ].join('\n')

  it('takes the Japanese model reading English text, with stray kana, for no other script', () => {
    expect(pokemonLanguageOfReads({ jpn: BRONZONG_JPN, eng: BRONZONG_ENG })).toBe('en')
  })

  it('does not take kana the Japanese model makes of a noisy text box for Japanese', () => {
    // An English card with one attack (Mankey, Low Kick) on a mottled box: both models read noise.
    const mankey = {
      eng: '- Rs\n3 Rk -\n5 o ws\nXt . 3 - ot\na ¥ sN xu 8 ST\na ~',
      jpn: '$ 0 。 庄 凍\n* 3 : で っ 補\nビラ * 生 胃 』\n】 owa テ 20\n所 < 。 . る を 、\n了 区 可 ュ 4 。\n用 ( a: 学 。 例 メ\n誠二'
    }
    // A Chinese card (Probopass), its small text blurred past reading.
    const probopass = { eng: '- Rg J\nB 5\n0 NN\nhaa J 1', jpn: '島 か\nリャ て 16\nし 。 人 間 |' }
    expect(pokemonLanguageOfReads(mankey)).toBeNull()
    expect(pokemonLanguageOfReads(probopass)).toBeNull()
  })

  it("does not take the English model's garbage of Japanese text for English by its short words", () => {
    // Read off a real eBay photo of a Japanese Zoroark GX (ink on white): "of" three times, by chance.
    const zoroark = {
      eng: 'ELY O ow oo. . ai A of il ithe -~ , oom of aw\n3 > : i : ix. Pai Lh B oy of\nEW rN SF Popyd vo',
      jpn: 'の SU りく e 4 放 寺 へ 二 【 誠 癌 本 計 の 作 間\nミン 人 U、 いい きだ と'
    }
    expect(pokemonLanguageOfReads(zoroark)).toBeNull()
    // English card words alongside still make it English.
    expect(pokemonLanguage('the damage of this attack to your opponent')).toBe('en')
  })

  it('still takes a mostly Latin Japanese-model read in a European language for other', () => {
    const fr =
      'Si cette carte est dans votre main, vous pouvez la mettre sur le terrain de votre adversaire. ぅ て'
    expect(pokemonLanguageOfReads({ jpn: fr, eng: BRONZONG_ENG })).toBe('other')
  })
})

describe('pokemonLanguageOfBands', () => {
  const EN = 'Pikachu HP 60 Basic Pokémon Gnaw 10 Weakness Resistance Retreat Cost'
  const JA = 'ピカチュウ HP 60 ワザ 相手のバトルポケモンに10ダメージ'
  const ZH = '皮卡丘 HP 60 招式'
  const GARBAGE = 'l1 ,. ii'

  it.each([
    // The same text read off two bands (as it is, and as ink on white): one telling is enough.
    [{ eng: [GARBAGE, EN], jpn: [GARBAGE, GARBAGE] }, 'en'],
    [{ eng: [GARBAGE, GARBAGE], jpn: [JA, GARBAGE] }, 'ja'],
    // Bands that disagree tell nothing; any band's other is other.
    [{ eng: [EN, GARBAGE], jpn: [GARBAGE, JA] }, null],
    [{ eng: [EN, GARBAGE], jpn: [GARBAGE, ZH] }, 'other'],
    [{ eng: [GARBAGE, GARBAGE], jpn: [GARBAGE, GARBAGE] }, null],
    [{ eng: [], jpn: [] }, null]
  ] as const)('%j → %s', (reads, expected) => {
    expect(pokemonLanguageOfBands({ eng: [...reads.eng], jpn: [...reads.jpn] })).toBe(expected)
  })
})

describe('readsJapaneseName', () => {
  it('finds the printed name in a Japanese-model read of the name band, noise and all', () => {
    expect(readsJapaneseName('クチート', 'クチート')).toBe(true)
    expect(readsJapaneseName('~ クチート HP', 'クチート')).toBe(true)
    // A blurred read drops dakuten and spaces the letters out.
    expect(readsJapaneseName('トン メル', 'ドンメル')).toBe(true)
    // A suffix in Latin letters is left to the art.
    expect(readsJapaneseName('リザードン', 'リザードンex')).toBe(true)
    // One letter wrong in a long name still counts.
    expect(readsJapaneseName('フシギバナ', 'フシギダネ')).toBe(false)
    expect(readsJapaneseName('ライチユウ', 'ライチュウ')).toBe(true)
  })

  it('never in a read without the name, nor of a name too short or with too little kana', () => {
    expect(readsJapaneseName('ピカチュウ', 'ライチュウ')).toBe(false)
    expect(readsJapaneseName('', 'ピカチュウ')).toBe(false)
    // Two letters: a chance read of noise.
    expect(readsJapaneseName('ミュウ', 'ミュ')).toBe(false)
    // Han alone a Chinese card prints alike.
    expect(readsJapaneseName('博士の研究', '博士の研究')).toBe(true)
    expect(readsJapaneseName('博士研究', '博士研究')).toBe(false)
    // A Chinese card's name, in Han, never reads as the Japanese katakana.
    expect(readsJapaneseName('皮卡丘', 'ピカチュウ')).toBe(false)
  })
})

describe('readsEnglishName', () => {
  it('finds the name in a read of the name band, one letter off in a long one', () => {
    expect(readsEnglishName('~ Charizard ex', 'Charizard ex')).toBe(true)
    expect(readsEnglishName('Charlzard', 'Charizard')).toBe(true)
    expect(readsEnglishName('Charmeleon', 'Charizard')).toBe(false)
    // Short names one letter off are other names (Mew, Mewtwo; Abra, Arbok).
    expect(readsEnglishName('Abra', 'Abra')).toBe(true)
    expect(readsEnglishName('Arba', 'Abra')).toBe(false)
    expect(readsEnglishName('Mew', 'Mew')).toBe(false)
  })
})

describe("pokemonLanguage on a model's garbage", () => {
  it('does not take short capitals a blurred English text box reads as for French', () => {
    // Read off an owner photo of an English card (shot_0048), and part of an eBay one.
    expect(
      pokemonLanguage(
        'ELLE EAS SAE\n1 Ce ow a, cea! . -, x - 1 . .e Pam 3 ~\n: . ; . Se\nSY vr ‘ - Pl TN EN \\ eee Cee ey, oJ ‘e f SE\n- .. wo LE. ve . , . ~'
      )
    ).not.toBe('other')
    expect(pokemonLanguage('EE TE SE ER LE ET EN DE LA CE SI UN OU EST LES DES')).not.toBe('other')
    // A European card's own text, in lower case, still is.
    expect(pokemonLanguage('Mélangez votre main dans votre deck. Ensuite, piochez 4 cartes.')).toBe(
      'other'
    )
  })
})
