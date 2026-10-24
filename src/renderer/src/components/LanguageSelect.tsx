import { LANGUAGES, isLanguage, type Language, type LanguageFilter } from '@shared/languages'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'

interface Props {
  value: LanguageFilter
  onChange: (f: LanguageFilter) => void
  available: Language[]
}

/** "All languages" plus the languages that have data (and always the current choice). */
export function LanguageSelect({ value, onChange, available }: Props): React.JSX.Element {
  const shown = LANGUAGES.filter((l) => l.code === value || available.includes(l.code))
  return (
    <Select
      value={value}
      onValueChange={(v) => {
        if (v === 'all' || isLanguage(v)) onChange(v)
      }}
    >
      <SelectTrigger size="sm" aria-label="Language" className="w-40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All languages</SelectItem>
        {shown.map((l) => (
          <SelectItem key={l.code} value={l.code}>
            {l.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
