import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  MAX_PASSWORD,
  PASSWORDS_DIFFER,
  passwordPlaceholder,
  passwordStrength
} from '@shared/emailAuth'

const BAR = ['bg-destructive', 'bg-amber-500', 'bg-emerald-500'] as const
const TEXT = ['text-destructive', 'text-destructive', 'text-amber-500', 'text-emerald-500'] as const

/**
 * A new password, its strength, and a second box to confirm it. The strength is a guide only;
 * callers block on `newPasswordProblem`. The mismatch note waits until the confirmation goes wrong,
 * not while it is still being typed.
 */
export function NewPasswordFields({
  label = 'Password',
  value,
  onChange,
  confirm,
  onConfirmChange
}: {
  label?: string
  value: string
  onChange(v: string): void
  confirm: string
  onConfirmChange(v: string): void
}): React.JSX.Element {
  const strength = passwordStrength(value)
  const confirmLabel = `Confirm ${label.charAt(0).toLowerCase()}${label.slice(1)}`
  const differs = confirm.length > 0 && confirm !== value && !value.startsWith(confirm)
  return (
    <>
      <Input
        type="password"
        aria-label={label}
        placeholder={passwordPlaceholder(label, 'new-password')}
        autoComplete="new-password"
        maxLength={MAX_PASSWORD}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <div className="flex items-center gap-2">
          <div className="flex flex-1 gap-1" aria-hidden>
            {BAR.map((color, i) => (
              <span
                key={color}
                className={cn(
                  'h-1 flex-1 rounded-full transition-colors',
                  i < strength.score ? BAR[strength.score - 1] : 'bg-muted'
                )}
              />
            ))}
          </div>
          <span className={cn('text-xs', TEXT[strength.score])} aria-live="polite">
            Strength: {strength.label}
          </span>
        </div>
      )}
      <Input
        type="password"
        aria-label={confirmLabel}
        placeholder={confirmLabel}
        autoComplete="new-password"
        maxLength={MAX_PASSWORD}
        value={confirm}
        aria-invalid={differs || undefined}
        onChange={(e) => onConfirmChange(e.target.value)}
      />
      {differs && <p className="text-xs text-destructive">{PASSWORDS_DIFFER}</p>}
    </>
  )
}
