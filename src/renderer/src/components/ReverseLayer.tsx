import type { ReverseLook } from '@shared/reverseHolo'

const masked = (mask: string): React.CSSProperties => ({
  maskImage: mask,
  maskSize: '100% 100%',
  WebkitMaskImage: mask,
  WebkitMaskSize: '100% 100%'
})

/**
 * A reverse foil's still look over the card's image, in the box the image fills: the body around
 * the art dimmed and dulled, and the era's pattern printed into it where there is one. Each layer
 * blends with the image under it, so the box is isolated from whatever lies behind the card.
 */
export function ReverseLayer({ look }: { look: ReverseLook }): React.JSX.Element {
  const { region, pattern } = look
  // A drawn pattern carries the foil on its own, so the body is dimmed less under it.
  const strong = pattern === null
  return (
    <span
      aria-hidden
      data-testid="reverse-layer"
      data-pattern={pattern ? 'yes' : 'no'}
      className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"
    >
      <span
        className="absolute inset-0 mix-blend-multiply"
        style={{ ...masked(region), background: strong ? 'rgb(204 204 204)' : 'rgb(230 230 230)' }}
      />
      <span
        className="absolute inset-0 mix-blend-saturation"
        style={{ ...masked(region), background: 'rgb(128 128 128)', opacity: strong ? 0.32 : 0.15 }}
      />
      {pattern && (
        <span
          data-testid="reverse-pattern"
          className="absolute inset-0"
          style={{
            background: pattern.tint,
            mixBlendMode: pattern.restBlend,
            opacity: pattern.opacity,
            // Faded in under the card's heading, so its name and HP stay legible.
            maskImage: `${pattern.css}, ${region}, ${pattern.fade}`,
            maskSize: '100% 100%',
            maskComposite: 'intersect',
            WebkitMaskImage: `${pattern.css}, ${region}, ${pattern.fade}`,
            WebkitMaskSize: '100% 100%',
            WebkitMaskComposite: 'source-in'
          }}
        />
      )}
    </span>
  )
}
