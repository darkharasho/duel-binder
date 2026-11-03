import { useEffect, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

const COPIED_MS = 1500

/** A small button that copies a card's name, shown beside the name in a card's side panel. */
export function CopyNameButton({ name }: { name: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), COPIED_MS)
    return () => clearTimeout(t)
  }, [copied])

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(name)
      setCopied(true)
    } catch {
      toast.error("Couldn't copy the name")
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={copied ? 'Copied' : 'Copy name'}
      title={copied ? 'Copied' : 'Copy name'}
      onClick={() => void copy()}
      className="text-muted-foreground hover:text-foreground"
    >
      {copied ? <Check /> : <Copy />}
    </Button>
  )
}
