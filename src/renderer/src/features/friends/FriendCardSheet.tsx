import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Friend } from '@shared/types'
import { CardSheet } from '@/components/CardSheet'
import { api, queryKeys } from '@/lib/api'
import { DEFAULT_FILTERS } from '../collection/defaultFilters'
import { FriendEntryPanel } from './FriendEntryPanel'

/** A card a friend owns, opened from their set: their copies, read-only. */
export function FriendCardSheet({
  friend,
  cardId,
  entryId,
  onClose
}: {
  friend: Friend
  cardId: number
  /** The copy to show first. */
  entryId: number
  onClose: () => void
}): React.JSX.Element {
  const [selected, setSelected] = useState(entryId)
  const all = useQuery({
    queryKey: queryKeys.friendEntries(friend.id, DEFAULT_FILTERS),
    queryFn: () => api.friends.collection(friend.id, DEFAULT_FILTERS),
    retry: false
  })
  const copies = (all.data ?? []).filter((e) => e.card.id === cardId)
  const entry = copies.find((e) => e.id === selected) ?? copies[0]
  return (
    <CardSheet onClose={onClose}>
      {entry && <FriendEntryPanel entry={entry} copies={copies} onSelectEntry={setSelected} />}
    </CardSheet>
  )
}
