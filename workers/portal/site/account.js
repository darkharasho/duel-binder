// Swaps the nav's "Sign in" for the visitor's picture and name when they're signed in on the app.
;(async () => {
  const link = document.querySelector('a.signin')
  if (!link) return
  const res = await fetch(new URL('/api/site-account', link.href), { credentials: 'include' })
  if (res.status !== 200) return
  const { name, avatarUrl } = await res.json()
  const label = document.createElement('span')
  label.textContent = name
  link.replaceChildren(label)
  if (!avatarUrl) return
  const avatar = new Image(24, 24)
  avatar.alt = ''
  avatar.onerror = () => avatar.remove()
  avatar.src = avatarUrl
  link.prepend(avatar)
})().catch(() => {})
