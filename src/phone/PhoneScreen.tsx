import mark from '@/assets/logo-mark.svg'

/** Soft colour blobs drifting slowly behind the screen, in the app's glow colours. */
const BLOBS = [
  'left-[-30%] top-[-12%] size-[85vw] bg-violet-500/40 [animation:phone-blob-a_22s_ease-in-out_infinite_alternate]',
  'right-[-35%] top-[18%] size-[75vw] bg-amber-500/25 [animation:phone-blob-b_27s_ease-in-out_infinite_alternate]',
  'bottom-[-18%] left-[5%] size-[80vw] bg-fuchsia-500/20 [animation:phone-blob-c_31s_ease-in-out_infinite_alternate]'
]

/**
 * A full-screen panel in the phone's safe area, for the screens before the app (sign-in, first
 * run): the brand on its own (the binder mark without the icon's tile, the name set big beneath
 * it) in the middle, and the screen's own part (`children`) at the bottom, under the thumb.
 */
export function PhoneScreen({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <main className="relative isolate flex min-h-dvh flex-col items-center overflow-hidden bg-background px-7 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] text-center text-foreground">
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
      {/* A warm glow behind the mark, in its card's red. */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[18%] -z-10 size-80 -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(240,82,58,0.28),rgba(139,92,246,0.12)_45%,transparent_70%)]"
      />
      <div className="flex flex-1 flex-col items-center justify-center gap-6 py-8">
        <img
          src={mark}
          alt=""
          className="h-auto w-32 drop-shadow-[0_18px_30px_rgba(0,0,0,0.55)] min-[380px]:w-40"
        />
        <div aria-hidden className="space-y-4">
          <p className="bg-gradient-to-b from-[#fffaf0] to-[#e8dcc4] bg-clip-text text-[2.75rem] font-black uppercase leading-[0.92] tracking-[-0.035em] text-transparent">
            <span className="block">Duel</span>
            <span className="block">Binder</span>
          </p>
          <p className="text-xs font-semibold uppercase tracking-[0.32em] text-white/55">
            Scan · Collect · Track
          </p>
        </div>
      </div>
      <div className="flex w-full max-w-sm flex-col items-center gap-5">{children}</div>
    </main>
  )
}
