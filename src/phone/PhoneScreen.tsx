import logo from '@/assets/logo.svg'

/** A full-screen panel in the phone's safe area, for the screens before the app (sign-in, first run). */
export function PhoneScreen({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-background px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] text-center text-foreground">
      <img src={logo} alt="" className="size-16" />
      {children}
    </main>
  )
}
