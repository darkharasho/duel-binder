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
/** Lowest name similarity (1 - levenshtein / maxLen) accepted. */
export const NAME_MIN_SCORE = 0.8
/** Best name score minus second-best score needed to trust the best. */
export const NAME_MIN_MARGIN = 0.05
/** Consecutive frames that must agree before a card counts. */
export const STABLE_FRAMES = 2
/** How long a card must be gone before the same card can count again. */
export const ABSENT_MS = 600
