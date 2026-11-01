// Every scan confidence threshold lives here so they can be retuned against real photos.
// Distances are Hamming distances out of 256 bits.

/** Largest art distance still accepted as a match. */
export const ART_MAX_DISTANCE = 80
/** Largest art distance accepted when the lookup is restricted to the picked set. */
export const ART_MAX_DISTANCE_IN_SET = 80
/**
 * Distance of the closest artwork of a different card minus the best distance, needed to trust
 * the best.
 */
export const ART_MIN_MARGIN = 10
/**
 * How far behind the closest a Pokémon artwork may be and still be in its art group, which the
 * language or number then decides: reprints' and twins' reference scans of one artwork differ by
 * 20 bits and more, where Yu-Gi-Oh's ART_MIN_MARGIN is 10.
 */
export const PKM_ART_MIN_MARGIN = 24
/**
 * A Japanese card's printed name is evidence of its language (readsJapaneseName) with this many
 * kana and kanji or more, and may be read one letter off with JA_NAME_FUZZY_LENGTH.
 */
export const JA_NAME_MIN_LENGTH = 3
export const JA_NAME_FUZZY_LENGTH = 5
/** The same for an English card's name (readsEnglishName), in letters and digits. */
export const EN_NAME_MIN_LENGTH = 4
export const EN_NAME_FUZZY_LENGTH = 7
export const EN_NAME_FUZZIER_LENGTH = 12
/**
 * How much closer than its card art a reference scan of an art variant (an overframe, say) must
 * match a photo for the photo to be taken for that variant's printings (see artFamily in
 * resolve.ts). On the owner's photos, overframe and manga-art printings beat their card art by
 * 46-96; plain printings were beaten by another art's scan by at most 28 (alternate QCAC arts at
 * 12-16).
 */
export const ART_REF_MIN_MARGIN = 32
/**
 * How much closer one tone's scans (a Manga-Style card's Color or Monochrome) must match a photo
 * than the other tone's for the photo to be taken for that tone (see artFamily in resolve.ts);
 * nearer than that, both are left to pick from. The art hash is luminance only, but a colour
 * painting and its monochrome inks differ in it: on the owner's 11 YAC1 photos the right tone
 * was closer every time, by 4 to 42 bits (4, 8 and 8 the least). Colour itself is no help there:
 * foil glare and the camera's blue cast make monochrome foils read as saturated as colour ones.
 */
export const ART_TONE_MIN_LEAD = 8
/**
 * A card-shaped thing in view whose closest artwork is further off than this, and that reads as
 * no card by code or name, is taken for something else (a book, the deck on the desk): nothing in
 * view, rather than a card it couldn't recognize.
 */
export const ART_FAR_DISTANCE = 100
/** Closest artworks fetched per frame, so a different card shows up past a card's alternate arts. */
export const ART_MATCH_DEPTH = 20
/**
 * Without fingerprints, a card-shaped outline around the likeliest one replaces it only when it
 * is at least this many times its area: a card is about 1.44-1.5x its art-and-text frame, while
 * a sleeve is only about 1.18x the card in it.
 */
export const NEST_MIN_GROWTH = 1.3
/**
 * ...or when the likeliest one starts at least this share of the outer one's length in from one
 * of its ends: a frame inside the card starts below the name bar, while a sleeve's end is only a
 * few percent past the card's.
 */
export const NEST_MIN_END_INSET = 0.1
/**
 * Share of its size by which the straightened card's art box is also tried grown, shrunk and moved
 * (see jittered), for the card the outline finder settled on: an outline a few percent off, as a
 * case's or sleeve's edge makes, moves the art box as far and costs the hash dozens of bits.
 */
export const ART_BOX_JITTER = 0.03
/**
 * A card-shaped outline round another counts as a case or toploader holding it (and goes after
 * it among the candidates) when the border between them is at least this many card widths on
 * every side (a sleeve's or the card's own printed edge is thinner)...
 */
export const HOLDER_MIN_BORDER = 0.02
/** ...at most this many... */
export const HOLDER_MAX_BORDER = 0.35
/**
 * ...and its widest side at most this many times its narrowest: a case's border is the same all
 * round, while a card's art-and-text frame sits about four times deeper below its top than above
 * its bottom.
 */
export const HOLDER_EVENNESS = 2.5
/**
 * ...and the border is see-through: on at least HOLDER_CLEAR_SIDES sides it differs from what
 * lies just outside by at most this much (mean absolute difference per channel, 0-255).
 */
export const HOLDER_MAX_CONTRAST = 45
export const HOLDER_CLEAR_SIDES = 2
/** Lowest name similarity (1 - levenshtein / maxLen) accepted. */
export const NAME_MIN_SCORE = 0.8
/** Best name score minus second-best score needed to trust the best. */
export const NAME_MIN_MARGIN = 0.05
/** Consecutive frames that must agree before a card counts. */
export const STABLE_FRAMES = 2
/** How long a card must be gone before the same card can count again. */
export const ABSENT_MS = 600

// Rarity from the card's look, tuned on real webcam photos. A reading of the name's ink counts
// only when it is a line of text where a name starts.
/** The name's text line must start within this share of the name band's width. */
export const NAME_INK_MAX_LEFT = 0.1
/** ...be at least this share of the band's height tall... */
export const NAME_INK_MIN_HEIGHT = 0.45
/** ...hold at least this many letters and marks... */
export const NAME_INK_MIN_BLOBS = 5
/**
 * ...and this many times the blobs the other ink finds: a blurred frame reads as much light
 * texture as dark.
 */
export const NAME_INK_MIN_DOMINANCE = 1.25
/** Gold ink: its hue in this range of degrees... */
export const NAME_GOLD_HUES = [30, 70] as const
/** ...at least this saturated (0–1)... */
export const NAME_GOLD_MIN_SATURATION = 0.25
/** ...and this many degrees from the bar's hue, so a gold-tinted bar's own colour doesn't count. */
export const NAME_GOLD_MIN_HUE_GAP = 20
/** Silver ink: lighter than the bar and at most this share of its saturation... */
export const NAME_SILVER_MAX_SATURATION_RATIO = 0.65
/** ...or at most this saturated outright (for a grey bar)... */
export const NAME_SILVER_MAX_SATURATION = 0.1
/** ...or its coloured pixels spread over hues this much (1 - mean resultant length). */
export const NAME_SILVER_MIN_HUE_SPREAD = 0.35
/**
 * A dark name rules prismatic out (off pale bars) only when its ink is at least this much darker
 * than the bar, in luma 0-1. Of 30 prismatic names that read dark on dark-name frames over the
 * eBay photos, TCGplayer and Yugipedia scans and their degraded copies, none reached it (the
 * darkest 0.207); 182 of 335 plain names there did.
 */
export const NAME_PRISMATIC_MAX_DARK_CONTRAST = 0.21
/** Frames of one showing that must read the name's ink before it decides the rarity. */
export const RARITY_MIN_READINGS = 2
/** Share of those readings that must agree. */
export const RARITY_MIN_AGREEMENT = 0.8
/** Latest readings of the card in view that are kept. */
export const RARITY_MAX_READINGS = 10
/** Common words of one language a read of a card's text needs before its language counts. */
export const LANGUAGE_MIN_WORDS = 3
/** Lowest OCR confidence (0-100) at which a read of a card's text names its script. */
export const LANGUAGE_MIN_CONFIDENCE = 28
/** OCR confidence the best script's read needs over every other script's. */
export const LANGUAGE_MIN_MARGIN = 5
/** Characters of its own script a non-Latin read needs, so garbage in it doesn't count. */
export const LANGUAGE_MIN_SCRIPT_CHARS = 5
/** Latin letters a read of a Pokémon card's text needs before it counts as English. */
export const LANGUAGE_MIN_LATIN_CHARS = 8
/**
 * Japanese Pokémon card words (ポケモン, ダメージ, ...) a read needs before it counts as Japanese:
 * the Japanese model makes kana of noise, but not these words.
 */
export const LANGUAGE_MIN_JA_WORDS = 2
/** Frames a card's text is read on to tell its language before it's taken in its first one. */
export const LANGUAGE_MAX_READS = 3
/** Past LANGUAGE_MAX_READS, frames between further reads of a Pokémon card held in view. */
export const LANGUAGE_RETRY_FRAMES = 8
/**
 * Where a Pokémon card that can't be named for certain may be named as a best guess (ScanDraft.guess),
 * by what stood in the way of certainty:
 * - language: its text told no language, but its name band nearly reads a card's name
 *   (PKM_GUESS_NAME_LIKENESS).
 * - language-default: its text told no language and nothing else did either; English.
 * - reprint: several cards of one name in the language; the closest art.
 * - misread: a number naming nothing in the art group; taken as a misread and ignored.
 * - twin: a reprint with no artwork to match (ScanPrinting.unseenTwin).
 * - twin-maybe: such a reprint whose product photo may be other art (PKM_TWIN_MAYBE_ART).
 * - behind: a reprint past the art group's margin (reprintBehind).
 * - holder: art found by the holder search, with another name close (clearOfOtherNames).
 */
export type PkmGuessRule =
  | 'language'
  | 'language-default'
  | 'reprint'
  | 'misread'
  | 'twin'
  | 'twin-maybe'
  | 'behind'
  | 'holder'
/**
 * The rules on, the most right answers with wrong at most PKM_MAX_WRONG_SHARE on the owner's photos
 * and overall (tests/main/scan-pkm-guess-curve.test.ts replays the others). Language-default costs
 * 12 Chinese photos; twin is right less often than wrong.
 */
export const PKM_GUESS_RULES: readonly PkmGuessRule[] = [
  'language',
  'reprint',
  'misread',
  'twin-maybe',
  'holder'
]
/**
 * How nearly a name band must read a card's name (englishNameLikeness, japaneseNameLikeness) for
 * the language rule. On the 200 photos whose art matched and whose text told no language, 0.5
 * reached 40 English and 16 Japanese photos and 1 in the wrong language; no Chinese one reached
 * even 0.4.
 */
export const PKM_GUESS_NAME_LIKENESS = 0.5
/**
 * How far an unseen twin's product photo must be from a card's art to be other art of the same
 * name and illustrator. Over the 1,058 English pairs, reprints sit mostly under 100 (poor product
 * photos reach about 104) and other art gathers at 120 to 130.
 */
export const PKM_TWIN_OTHER_ART = 120
/**
 * Below PKM_TWIN_OTHER_ART, how far a product photo must be for the card to be named as a best
 * guess, not left unnamed. From here up the pairs are a mix: 30th Celebration's 031 and its
 * same-artist Trainer Gallery Pikachu at 110 are other art, Energy Search's reprint at 110 isn't.
 */
export const PKM_TWIN_MAYBE_ART = 100
/**
 * How much closer the closest reprint's art must be than the next's for the reprint rule to name
 * it. Art hardly tells reprints apart: of 35 guesses, 15 were right with no lead asked, 12 of 30
 * at 2, 9 of 16 at 4. None is asked: a sleeved card's art often ties its reprints exactly, its
 * number can't be read, and a flagged guess beats it never counting.
 */
export const PKM_GUESS_REPRINT_LEAD = 0
/**
 * The same lead for a photo. It's taken to be sure, with time to read the number instead, and with
 * no lead it named the right Pokémon's wrong printing three times as often (21 wrong to 7 of 719).
 */
export const PKM_PHOTO_REPRINT_LEAD = 1
/**
 * Consecutive frames a best guess must hold before it counts: past every frame that may still
 * read the language, so a certain answer gets its chance first.
 */
export const GUESS_STABLE_FRAMES = LANGUAGE_MAX_READS + 1

/**
 * Consecutive frames a best guess of another card must hold while a counted card hasn't cleared. A
 * hand swapping toploaders rarely leaves the view empty, and those cards are mostly guesses.
 */
export const GUESS_SWAP_FRAMES = GUESS_STABLE_FRAMES * 2

// A Pokémon card's version from its foil. Texture is the median fine texture of a region of the
// straightened card, in luma levels (vision/foil.ts). On real photos the frame's doesn't tell a
// reverse holo from a normal card, so only Holofoil is ever named (pokemonVersion).
/** A frame texture at least this reads as foil on the frame (reverse holo), naming nothing... */
export const VERSION_FRAME_FOIL_MIN = 2
/** ...and at most this as a plain frame. */
export const VERSION_FRAME_PLAIN_MAX = 0.6
/** An art-window texture at least this reads as foil on the art (holo). */
export const VERSION_ART_FOIL_MIN = 6
/** The foiled region must be this many times as textured as the other (frame against art). */
export const VERSION_OTHER_RATIO = 2
/** ...and this many times as textured as the card's text box, which noise and detail hit too. */
export const VERSION_REFERENCE_RATIO = 1.5

// A graded slab's label block, untuned until real photos (Task 13). Boxes are in card widths and
// heights from the card's top-left corner (u across, v down), so they hold at any distance.
/** The label block sits above the card: v from here... */
export const SLAB_LABEL_V = [-0.26, -0.06] as const
/** ...and u from here (a label is about as wide as the card). */
export const SLAB_LABEL_U = [0.08, 0.92] as const
/** A label sample at least this bright (luma 0-255) counts as the label's paper... */
export const SLAB_LABEL_MIN_BRIGHT = 170
/** ...and this share of the label box must be paper. */
export const SLAB_LABEL_MIN_PAPER_SHARE = 0.6
/**
 * Text is where a row of the label box flips between paper and a sample this much darker, at
 * least this many times over the whole box (a plain strip, or a margin, flips none).
 */
export const SLAB_INK_DARKER_BY = 80
export const SLAB_TEXT_MIN_FLIPS = 12
/**
 * The label's paper must be this much brighter (luma) than the holder beside it and the strip
 * above it, which is plastic over the desk: a bright desk or a card sleeve's glare isn't a label.
 */
export const SLAB_MIN_CONTRAST = 40

/** Frames a photo looks at, this far apart, stopping at the first that names a card for certain. */
export const PHOTO_FRAMES = 3
export const PHOTO_GAP_MS = 150
/** How long a card stays in view undecided before the loop takes a photo of it unasked. */
export const AUTO_PHOTO_MS = 2500
/** Photos taken unasked of one card in view: it may be held better for the second. */
export const AUTO_PHOTO_TRIES = 2
/** After a photo, the live scan counts nothing until the view clears, or this long at most. */
export const PHOTO_SETTLE_MS = 4000
