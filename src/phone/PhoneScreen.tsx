import logo from '@/assets/logo.svg'

/** Soft colour blobs drifting slowly behind the screen, in the app's glow colours. */
const BLOBS = [
  'left-[-30%] top-[-12%] size-[85vw] bg-violet-500/40 [animation:phone-blob-a_22s_ease-in-out_infinite_alternate]',
  'right-[-35%] top-[18%] size-[75vw] bg-amber-500/25 [animation:phone-blob-b_27s_ease-in-out_infinite_alternate]',
  'bottom-[-18%] left-[5%] size-[80vw] bg-fuchsia-500/20 [animation:phone-blob-c_31s_ease-in-out_infinite_alternate]'
]

/** A full-screen panel in the phone's safe area, for the screens before the app (sign-in, first run). */
export function PhoneScreen({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <main className="relative isolate flex min-h-dvh flex-col items-center justify-center gap-6 overflow-hidden bg-background px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] text-center text-foreground">
      <div
        aria-hidden
        data-testid="phone-blobs"
        className="pointer-events-none absolute inset-0 -z-10"
      >
        {BLOBS.map((b) => (
          <div
            key={b}
            className={`absolute rounded-full blur-[80px] motion-reduce:animate-none ${b}`}
          />
        ))}
      </div>
      <img src={logo} alt="" className="size-16" />
      {children}
    </main>
  )
}
