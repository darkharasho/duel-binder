import type { Language } from '@shared/languages'
import { languageInfo } from '@shared/languages'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

/** A small badge naming a non-English language; renders nothing for English. */
export function LanguageTag({
  language,
  className
}: {
  language: Language
  className?: string
}): React.JSX.Element | null {
  if (language === 'en') return null
  const info = languageInfo(language)
  return (
    <Badge
      variant="secondary"
      title={info.label}
      className={cn('px-1.5 py-0 text-[10px]', className)}
    >
      {info.tag}
    </Badge>
  )
}
