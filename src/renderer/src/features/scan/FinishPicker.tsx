import { useGame } from '@/lib/game'
import { useScanPickers } from './pickerOptions'
import { SearchPicker } from './SearchPicker'

/**
 * The Scan page's "Finish" setting, Magic only: Auto (non-foil where a card comes in both),
 * Non-foil or Foil, for this session.
 */
export function ScanFinishPicker(): React.JSX.Element | null {
  const { game } = useGame()
  const { finish } = useScanPickers()
  if (game !== 'mtg') return null
  return (
    <span className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">Finish</span>
      <SearchPicker
        label="Finish"
        value={finish.value}
        options={finish.options}
        onPick={finish.onPick}
        searchPlaceholder="Search finishes…"
        className="w-32"
      />
    </span>
  )
}
