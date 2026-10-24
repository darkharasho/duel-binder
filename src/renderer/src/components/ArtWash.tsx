/** A heavily blurred copy of the page's key art, fading out down the window. Purely decorative. */
export function ArtWash({ src }: { src: string | null }): React.JSX.Element | null {
  if (!src) return null
  return (
    <div
      aria-hidden
      data-testid="art-wash"
      className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[560px] overflow-hidden [mask-image:linear-gradient(180deg,#000_25%,transparent)]"
    >
      <div
        key={src}
        className="absolute -inset-16 animate-in fade-in bg-cover bg-[center_30%] opacity-30 blur-[70px] saturate-[1.15] duration-700"
        style={{ backgroundImage: `url("${src}")` }}
      />
    </div>
  )
}
