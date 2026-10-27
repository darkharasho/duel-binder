/**
 * An iPhone home-screen app with a see-through status bar lays out a viewport shorter than the
 * screen by the status bar's height (59pt on a Dynamic Island phone): fixed and dvh-sized boxes
 * stop there, leaving a bare strip along the bottom. There, --app-height is the screen's own
 * height, which the shell and the picker sheet use; elsewhere it's unset and they fill the
 * viewport. Android and browser tabs report their viewport right and are left alone.
 */
export function fitScreen(): void {
  // `navigator.standalone` is iOS Safari's own: true in a home-screen app.
  if ((navigator as Navigator & { standalone?: boolean }).standalone !== true) return
  const fit = (): void => {
    // iOS gives the screen's size in portrait whatever the orientation.
    const { width, height } = screen
    const landscape = matchMedia('(orientation: landscape)').matches
    const tall = landscape ? Math.min(width, height) : Math.max(width, height)
    document.documentElement.style.setProperty(
      '--app-height',
      `${Math.max(tall, window.innerHeight)}px`
    )
  }
  fit()
  window.addEventListener('resize', fit)
}
