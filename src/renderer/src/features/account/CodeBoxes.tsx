import { useRef } from 'react'
import { CODE_LENGTH } from '@shared/emailAuth'

const digitsOf = (s: string): string => s.replace(/\D/g, '')

/**
 * The six boxes of an emailed code. A paste or an autofill of the whole code (it lands in the box
 * the person is in) fills all six; typing a digit moves on to the next box.
 */
export function CodeBoxes({
  value,
  onChange,
  disabled
}: {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}): React.JSX.Element {
  const boxes = useRef<(HTMLInputElement | null)[]>([])
  const focus = (i: number): void =>
    boxes.current[Math.min(Math.max(i, 0), CODE_LENGTH - 1)]?.focus()

  const fillAll = (digits: string): void => {
    const code = digits.slice(0, CODE_LENGTH)
    onChange(code)
    focus(code.length)
  }
  const setAt = (i: number, digit: string): void => {
    const chars = Array.from({ length: CODE_LENGTH }, (_, k) => value[k] ?? '')
    chars[i] = digit
    onChange(chars.join(''))
  }

  return (
    <div role="group" aria-label="Code" className="flex justify-center gap-2">
      {Array.from({ length: CODE_LENGTH }, (_, i) => (
        <input
          key={i}
          ref={(el) => {
            boxes.current[i] = el
          }}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          aria-label={`Digit ${i + 1}`}
          disabled={disabled}
          value={value[i] ?? ''}
          className="h-12 w-10 rounded-md border border-input bg-transparent text-center text-xl outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30"
          onChange={(e) => {
            const digits = digitsOf(e.target.value)
            if (digits.length > 1) return fillAll(digits)
            setAt(i, digits)
            if (digits) focus(i + 1)
          }}
          onPaste={(e) => {
            const digits = digitsOf(e.clipboardData.getData('text'))
            if (!digits) return
            e.preventDefault()
            fillAll(digits)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !value[i]) focus(i - 1)
            else if (e.key === 'ArrowLeft') focus(i - 1)
            else if (e.key === 'ArrowRight') focus(i + 1)
          }}
        />
      ))}
    </div>
  )
}
