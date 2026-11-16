/** The site page where people ask to join the Android or iPhone beta. */
export const PHONE_BETA_URL = 'https://duelbinder.com/beta'

/** Desktop and web Settings: the store apps are in beta, and where to ask to join. */
export function PhoneBetaSection(): React.JSX.Element {
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        Duel Binder for Android and iPhone is in beta. Ask to join, and you'll get an email when
        you're in.
      </p>
      <a
        href={PHONE_BETA_URL}
        target="_blank"
        rel="noreferrer"
        className="inline-block text-sm underline underline-offset-2 hover:text-foreground"
      >
        Join the phone beta
      </a>
    </div>
  )
}
