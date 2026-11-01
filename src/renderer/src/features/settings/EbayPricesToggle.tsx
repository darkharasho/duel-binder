import { useId } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Checkbox } from '@/components/ui/checkbox'
import { api } from '@/lib/api'

const KEY = ['prices', 'ebayHidden']

/** Whether this device shows eBay asking prices, which can run far over what cards sell for. */
export function EbayPricesToggle({ className }: { className?: string }): React.JSX.Element {
  const id = useId()
  const client = useQueryClient()
  const { data: hidden = false } = useQuery({
    queryKey: KEY,
    queryFn: () => api.prices.ebayHidden()
  })
  return (
    <div className={className ?? 'flex items-start gap-3 text-sm'}>
      <Checkbox
        id={id}
        checked={!hidden}
        onCheckedChange={(c) => {
          void api.prices.setEbayHidden(c !== true).then(() => client.invalidateQueries())
        }}
        className="mt-0.5"
      />
      <label htmlFor={id} className="space-y-0.5">
        <span className="block">Show eBay prices</span>
        <span className="block text-muted-foreground">
          These are asking prices, and can run high. With this off, cards use their market price, or
          show no price if they have none, and your totals leave them out.
        </span>
      </label>
    </div>
  )
}
