/**
 * Card tiles with a favourite heart on the name row. The heart can't sit inside the tile's button
 * (a button in a button), so it is the button's sibling: the tile is a grid, the button spans its
 * rows as a subgrid, and the heart takes the name's row, so it lines up with the name however tall
 * the art is. The button's children go one per row: the art (spacing below it as a margin), the
 * name, then the rest in one element. The rows other than the name's may carry margins; the name's
 * may not, or the heart would sit off centre.
 */

/** On the tile (the `li`): art, name and the rest, in three rows. */
export const TILE = 'group/tile grid grid-cols-[minmax(0,1fr)] grid-rows-[auto_auto_1fr]'
/**
 * On the tile's button: spans the three rows from the first cell, laying its children into them. Its
 * start is fixed: auto-placed, it would go below the heart's fixed cell and leave the heart on top.
 */
export const TILE_BUTTON =
  '[grid-area:1/1/span_3] grid min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-subgrid'
/** On the name: leaves room for the heart, so a long name truncates before it. */
export const TILE_NAME = 'pr-7'
/** On the heart: the name's row, at its right, inside the button's `p-1`. */
export const TILE_HEART = 'col-start-1 row-start-2 mr-1 self-center justify-self-end'

/** A checklist tile, with the card's number in a row of its own between the art and the name. */
export const NUMBERED_TILE =
  'group/tile grid grid-cols-[minmax(0,1fr)] grid-rows-[auto_auto_auto_1fr]'
export const NUMBERED_TILE_BUTTON =
  '[grid-area:1/1/span_4] grid min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-subgrid'
/** On a checklist tile's heart: the name's row, inside the button's `p-1.5`. */
export const NUMBERED_TILE_HEART = 'col-start-1 row-start-3 mr-1.5 self-center justify-self-end'

/** A tile heart button's look and reach (see FavouriteHeart); `data-on` keeps it shown. */
export const HEART_BUTTON = [
  'relative z-10 grid size-6 shrink-0 place-items-center rounded-full text-muted-foreground outline-none transition-opacity hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
  "after:absolute after:-inset-1 after:content-[''] max-md:after:-inset-2.5 [@media(pointer:coarse)]:after:-inset-2.5",
  'opacity-0 focus-visible:opacity-100 group-hover/tile:opacity-100 group-focus-within/tile:opacity-100 data-[on=true]:opacity-100 max-md:opacity-100 [@media(pointer:coarse)]:opacity-100'
].join(' ')
