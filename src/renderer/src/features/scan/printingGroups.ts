/**
 * A scan row's printing choices (see choicesFor) as the two-part pickers show them: the sets first,
 * one per code and set name, then the versions of the set picked (its rarities, with any note such
 * as a price or language tag). Shared by the desktop's dropdown and the phone's sheet; display only,
 * as a version's option is the very one choicesFor made.
 */

import type { PickerOption } from './SearchPicker'

export interface PrintingVersion {
  option: PickerOption
  /** What the version column shows: the rarity, or the whole label when the option has no set. */
  text: string
  /** A price or language tag, kept apart so it can sit to the right. */
  note?: string
}

export interface PrintingGroup {
  key: string
  /** The code badge, as the flat picker showed it. */
  badge?: string
  /** The set's name; empty when its options name none (one Pokémon set, a native-script set). */
  title: string
  versions: PrintingVersion[]
}

/**
 * The options by set, in the order they first come. A set is a code and set name: an option with
 * a rarity apart (see printingParts) has its title as the set's name; one without names no set,
 * its title being the rarity, so it falls in with the others of its code.
 */
export function groupPrintings(options: readonly PickerOption[]): PrintingGroup[] {
  const groups = new Map<string, PrintingGroup>()
  for (const o of options) {
    const split = o.title !== undefined && o.rarity !== undefined
    const title = split ? o.title! : ''
    const key = `${o.badge ?? ''}\u0000${title}`
    let group = groups.get(key)
    if (!group) {
      group = { key, badge: o.badge, title, versions: [] }
      groups.set(key, group)
    }
    group.versions.push(
      o.title === undefined
        ? { option: o, text: o.label }
        : { option: o, text: (split ? o.rarity : o.title)!, note: o.note }
    )
  }
  return [...groups.values()]
}

/**
 * The groups holding a version that matches every word of the query, with only those versions.
 * A version's search text holds its set's code and name too, so a query naming a set keeps all of
 * that set's versions, and one naming a rarity keeps the sets that came in it.
 */
export function filterGroups(groups: readonly PrintingGroup[], query: string): PrintingGroup[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return [...groups]
  const shown: PrintingGroup[] = []
  for (const g of groups) {
    const versions = g.versions.filter((v) => {
      const text = v.option.search ?? v.option.label.toLowerCase()
      return words.every((w) => text.includes(w))
    })
    if (versions.length > 0) shown.push({ ...g, versions })
  }
  return shown
}

/** The key of the set holding the option `value`, or null when none does. */
export function groupKeyOf(groups: readonly PrintingGroup[], value: string | null): string | null {
  if (value === null) return null
  return groups.find((g) => g.versions.some((v) => v.option.key === value))?.key ?? null
}

/**
 * The set the versions show for: the one chosen while the search still lists it, else the first
 * listed, so a search down to one set opens it.
 */
export function activeGroup(
  shown: readonly PrintingGroup[],
  chosen: string | null
): PrintingGroup | undefined {
  return shown.find((g) => g.key === chosen) ?? shown[0]
}

/** A set's plain-text name, "LOB-EN005 Legend of Blue Eyes White Dragon", for accessible names. */
export function groupText(g: Pick<PrintingGroup, 'badge' | 'title'>): string {
  return [g.badge, g.title].filter(Boolean).join(' ')
}
