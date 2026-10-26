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
/** Closest artworks fetched per frame, so a different card shows up past a card's alternate arts. */
export const ART_MATCH_DEPTH = 20
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
/** Frames of one showing that must read the name's ink before it decides the rarity. */
export const RARITY_MIN_READINGS = 2
/** Share of those readings that must agree. */
export const RARITY_MIN_AGREEMENT = 0.8
