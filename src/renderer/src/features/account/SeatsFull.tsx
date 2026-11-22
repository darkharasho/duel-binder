import { SEATS_FULL_TEXT, WAITLIST_URL } from '@shared/cloud'

/** Sign-in's answer when the seat cap is reached: the message and where to join the waitlist. */
export function SeatsFull(): React.JSX.Element {
  return (
    <p role="alert" className="text-sm text-destructive">
      {SEATS_FULL_TEXT}{' '}
      <a href={WAITLIST_URL} target="_blank" rel="noreferrer" className="underline">
        Join the waitlist
      </a>
    </p>
  )
}
