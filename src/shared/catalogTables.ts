/**
 * The shared card catalog tables, in upload order. The portal's admin loader and the nightly
 * catalog job both read this list; keep it free of platform-bound imports.
 *
 * `columns` are the writable columns of the desktop table. `card_printings` leaves out `id`
 * (each store assigns its own) and `pkey` (generated); its `key` is `pkey`, which the loader
 * computes from language/card_id/set_name/set_code/set_rarity.
 */
export interface CatalogTable {
  name: string
  key: string[]
  columns: string[]
}

export const CATALOG_TABLES: CatalogTable[] = [
  {
    name: 'cards',
    key: ['id'],
    columns: [
      'id', 'name', 'type', 'frame_type', 'race', 'attribute', 'level', 'linkval', 'atk', 'def',
      'archetype', 'desc', 'tcgplayer_price', 'updated_at'
    ]
  },
  {
    name: 'card_images',
    key: ['image_id'],
    columns: ['image_id', 'card_id', 'sort_order', 'missing_from_api']
  },
  {
    name: 'card_printings',
    key: ['pkey'],
    columns: [
      'card_id', 'set_name', 'set_code', 'set_rarity', 'set_rarity_code', 'set_price',
      'missing_from_api', 'language', 'tcg_product_id', 'variant'
    ]
  },
  {
    name: 'sets',
    key: ['language', 'set_name'],
    columns: [
      'language', 'set_name', 'set_code', 'tcg_date', 'image_url', 'image_key', 'list_rows',
      'unmatched_rows'
    ]
  },
  { name: 'pack_art', key: ['set_name'], columns: ['set_name', 'image_url', 'image_key'] },
  { name: 'set_logos', key: ['set_name'], columns: ['set_name', 'image_url', 'image_key'] },
  { name: 'konami_logos', key: ['set_name'], columns: ['set_name', 'image_url', 'image_key'] },
  { name: 'tcgplayer_groups', key: ['group_id'], columns: ['group_id', 'modified_on'] },
  {
    name: 'tcgplayer_products',
    key: ['product_id'],
    columns: ['product_id', 'group_id', 'number', 'rarity', 'image_url', 'name']
  }
]
