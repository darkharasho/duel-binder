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
/** Frames of one showing that must read the name's ink before it decides the rarity. */
export const RARITY_MIN_READINGS = 2
/** Share of those readings that must agree. */
export const RARITY_MIN_AGREEMENT = 0.8
/** Latest readings of the card in view that are kept. */
export const RARITY_MAX_READINGS = 10
