// The home page's motion (see home.css). The page is complete without it: this only adds the
// binder's opening and scroll sequence, the wash that follows each section, and the small demos.
;(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  const fine = matchMedia('(pointer:fine)').matches
  const $ = (id) => document.getElementById(id)
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v))

  // ---------- Wash: cross-fade between two fixed layers; only opacity changes ----------
  const WASHES = JSON.parse($('washes').textContent)
  const first = document.querySelector('.wash')
  const second = first.cloneNode(false)
  second.classList.add('off')
  second.removeAttribute('style')
  first.after(second)
  const layers = [first, second]
  let front = 0
  let current = first.dataset.card
  const meta = document.querySelector('meta[name="theme-color"]')
  function setWash(name) {
    const w = WASHES[name]
    if (!w || name === current) return
    current = name
    const back = layers[1 - front]
    back.style.background = w.pools
    document.documentElement.style.backgroundColor = w.base
    if (meta) meta.content = w.base
    back.classList.remove('off')
    layers[front].classList.add('off')
    front = 1 - front
  }

  // ---------- Hero binder ----------
  const run = $('run'),
    pin = $('pin'),
    binder = $('binder'),
    tilt = $('tilt'),
    top = $('top')
  const chip = $('chip'),
    cue = $('cue'),
    turn = $('turn'),
    turnFront = $('turnFront'),
    turnBack = $('turnBack')
  const heroWash = run.dataset.wash,
    turnedWash = run.dataset.turned

  // The run is a tall block whose sticky pin holds the binder. Progress through it drives:
  //   0–.22   the binder lifts off the table to face you and grows to fill the screen
  //   .22–.40 the view moves in on the right-hand page (cards at their largest)
  //   .48–.80 that page turns over to the next spread while the view pulls back
  const seg = (p, a, b) => clamp((p - a) / (b - a))
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
  const lerp = (a, b, t) => a + (b - a) * t
  const mix = (a, b, t) => ({
    s: lerp(a.s, b.s, t),
    tx: lerp(a.tx, b.tx, t),
    ty: lerp(a.ty, b.ty, t)
  })
  let geo = null
  function measure() {
    // offsets are relative to the pin (the binder's offsetParent); transforms don't change them
    const vw = pin.clientWidth,
      vh = pin.clientHeight
    const L = binder.offsetLeft,
      T = binder.offsetTop
    const Wb = binder.offsetWidth,
      u = Wb / 7.98,
      Hs = 4.95 * u
    const at = (s, fx, fy) => ({ s, tx: vw / 2 - L - fx * s, ty: vh / 2 - T - fy * s })
    const sB = Math.min((vw - 48) / Wb, (vh - 40) / Hs, 1.6)
    const sC = Math.min((vh - 36) / (4.71 * u), (vw - 40) / (3.9 * u), 2.4)
    geo = { A: { s: 1, tx: 0, ty: 0 }, B: at(sB, Wb / 2, Hs / 2), C: at(sC, 6.06 * u, Hs / 2) }
  }

  let px = 0,
    py = 0,
    raf = 0
  function frame() {
    raf = 0
    const total = run.offsetHeight - pin.clientHeight
    const p = reduce || total <= 0 ? 0 : clamp(-run.getBoundingClientRect().top / total)
    const lift = ease(seg(p, 0, 0.22)),
      zoom = ease(seg(p, 0.22, 0.4)),
      back = ease(seg(p, 0.48, 0.8))
    const cam =
      back > 0
        ? mix(geo.C, geo.B, back)
        : zoom > 0
          ? mix(geo.B, geo.C, zoom)
          : mix(geo.A, geo.B, lift)
    binder.style.transform = p > 0 ? `translate(${cam.tx}px, ${cam.ty}px) scale(${cam.s})` : ''
    const rx = reduce ? 10 : 34 * (1 - lift) - py * 5
    tilt.style.transform = `rotateX(${rx}deg) rotateY(${px * 6}deg)`
    top.style.opacity = 1 - seg(p, 0, 0.12)
    top.style.transform = p > 0 ? `translateY(${-60 * seg(p, 0, 0.2)}px)` : ''
    const opened = binder.classList.contains('opened')
    cue.style.opacity = opened && p < 0.02 && !reduce ? 0.8 : 0
    // the page turn; each face is switched off once it faces away (Firefox ignores backface on layers)
    const a = -180 * back
    tilt.classList.toggle('flat', back > 0 || binder.classList.contains('settled'))
    turn.style.transform = `translateZ(${back > 0 ? 6 : 0}px) rotateY(${a}deg)`
    turnFront.style.visibility = a > -90 ? 'visible' : 'hidden'
    turnBack.style.visibility = a <= -90 ? 'visible' : 'hidden'
    if (opened && p < 0.9) setWash(a <= -90 ? turnedWash : heroWash)
  }
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(frame)
  }
  const remeasure = () => {
    measure()
    schedule()
  }
  measure()
  frame()
  addEventListener('scroll', schedule, { passive: true })
  addEventListener('resize', remeasure)
  // the headline's height changes once the web font arrives, which moves the binder
  if (document.fonts) document.fonts.ready.then(remeasure)
  addEventListener('load', remeasure)

  // The one load sequence: the cover swings open, then light sweeps across the sleeves.
  setTimeout(
    () => {
      binder.classList.add('opened')
      // once the cover is down it lies flat as the left page (see .settled in home.css)
      const settle = () => {
        binder.classList.add('settled')
        frame()
      }
      if (reduce) return settle()
      setTimeout(settle, 1400)
      setTimeout(() => binder.classList.add('sweep'), 1100)
      setTimeout(() => {
        binder.classList.remove('sweep')
        schedule()
      }, 1700)
    },
    reduce ? 0 : 500
  )

  // Pointer: the binder leans toward it, the card under it lifts and catches the light.
  if (!reduce && fine) {
    const pockets = [...binder.querySelectorAll('.pocket')]
    const showing = (p) => getComputedStyle(p.closest('.face') || p).visibility !== 'hidden'
    binder.addEventListener('pointermove', (e) => {
      const r = binder.getBoundingClientRect(),
        pr = pin.getBoundingClientRect()
      px = (e.clientX - r.left) / r.width - 0.5
      py = (e.clientY - r.top) / r.height - 0.5
      binder.style.setProperty('--gx', `${40 + px * 120}%`)
      schedule()
      let hit = null
      for (const p of pockets) {
        const b = p.getBoundingClientRect()
        const inside =
          !hit &&
          showing(p) &&
          e.clientX >= b.left &&
          e.clientX <= b.right &&
          e.clientY >= b.top &&
          e.clientY <= b.bottom
        p.classList.toggle('lit', inside)
        if (inside) {
          hit = p
          p.style.setProperty('--sx', `${((e.clientX - b.left) / b.width - 0.5) * 120}%`)
        }
      }
      if (hit && binder.classList.contains('opened')) {
        const b = hit.getBoundingClientRect()
        chip.replaceChildren()
        const name = document.createElement('b')
        name.textContent = hit.dataset.name
        const code = document.createElement('span')
        code.className = 'mono'
        code.textContent = hit.dataset.code
        chip.append(name, code, hit.dataset.price)
        const x = clamp(b.left - pr.left + b.width * 0.55, 4, pr.width - chip.offsetWidth - 4)
        const y = Math.max(4, b.top - pr.top - chip.offsetHeight + 10)
        chip.style.transform = `translate(${x}px, ${y}px)`
        chip.classList.add('on')
      } else chip.classList.remove('on')
    })
    binder.addEventListener('pointerleave', () => {
      px = py = 0
      schedule()
      chip.classList.remove('on')
      pockets.forEach((p) => p.classList.remove('lit'))
    })
    addEventListener('scroll', () => chip.classList.remove('on'), { passive: true })
  }

  // ---------- The wash follows whichever section is in the middle of the screen ----------
  const games = [...document.querySelectorAll('.game')]
  const io = new IntersectionObserver(
    (es) => {
      for (const e of es)
        if (e.isIntersecting) {
          games.forEach((g) => g.classList.toggle('cur', g === e.target))
          if (e.target !== run) setWash(e.target.dataset.wash)
        }
    },
    { rootMargin: '-45% 0px -45% 0px' }
  )
  document.querySelectorAll('main [data-wash]').forEach((el) => io.observe(el))
  io.observe(run)

  // ---------- Staggered entrances ----------
  const rio = new IntersectionObserver(
    (es) =>
      es.forEach((e) => {
        if (!e.isIntersecting) return
        e.target.classList.add(e.target.classList.contains('shot') ? 'settled' : 'in')
        rio.unobserve(e.target)
      }),
    { threshold: 0.18 }
  )
  document.querySelectorAll('.rise, .shot').forEach((el) => rio.observe(el))

  // ---------- Scanner: plays when it comes into view, and again when a mode is picked ----------
  const screen = $('screen'),
    scount = $('scount'),
    note = $('modenote')
  const modes = [...document.querySelectorAll('.modes button')]
  let count = Number(scount.textContent),
    timers = []
  function scan(mode) {
    timers.forEach(clearTimeout)
    timers = []
    screen.className = `screen m-${mode}`
    const at = (ms, f) => timers.push(setTimeout(f, reduce ? 0 : ms))
    at(60, () => screen.classList.add('run-scan'))
    at(800, () => screen.classList.add('locked'))
    at(1400, () => {
      screen.classList.add('added')
      scount.textContent = ++count
    })
  }
  modes.forEach((b) =>
    b.addEventListener('click', () => {
      modes.forEach((x) => x.setAttribute('aria-pressed', String(x === b)))
      note.textContent = b.dataset.note
      scan(b.dataset.mode)
    })
  )
  new IntersectionObserver(
    ([e], o) => {
      if (!e.isIntersecting) return
      setTimeout(() => scan('card'), reduce ? 0 : 400)
      o.disconnect()
    },
    { threshold: 0.5 }
  ).observe(screen)

  // ---------- Set checklist: tap a grey card to mark it yours ----------
  const slots = $('slots'),
    setn = $('setn'),
    setbar = $('setbar')
  const totalSlots = Number(slots.dataset.total)
  slots.querySelectorAll('.miss').forEach((s) =>
    s.addEventListener('click', () => {
      s.classList.remove('miss')
      s.classList.add('got')
      s.disabled = true
      const got = totalSlots - slots.querySelectorAll('.miss').length
      setn.textContent = `${got} of ${totalSlots}`
      setbar.style.setProperty('--p', got / totalSlots)
    })
  )

  // ---------- Sync: add a card on the phone, watch it arrive on the other two ----------
  const devs = [...document.querySelectorAll('.dev')]
  const [laptop, phone] = devs
  const lists = devs.slice(0, 2).map((d) => d.querySelector('.list'))
  const initial = lists.map((l) => l.innerHTML)
  const totals = [...document.querySelectorAll('.dev .total')]
  const btn = $('syncbtn'),
    label = btn.textContent
  // Puts the new card first in a list; the others slide along (FLIP) and the last one drops off.
  function insertFirst(list, template) {
    const kids = [...list.children],
      before = kids.map((k) => k.getBoundingClientRect())
    list.prepend($(template).content.cloneNode(true))
    list.lastElementChild.remove()
    if (reduce) return
    kids.slice(0, -1).forEach((k, i) => {
      const a = k.getBoundingClientRect()
      k.animate(
        [
          { transform: `translate(${before[i].left - a.left}px, ${before[i].top - a.top}px)` },
          { transform: 'none' }
        ],
        {
          duration: 460,
          easing: 'cubic-bezier(.2,.8,.2,1)'
        }
      )
    })
    list.firstElementChild.animate(
      [
        { transform: 'scale(.4)', opacity: 0 },
        { transform: 'none', opacity: 1 }
      ],
      {
        duration: 520,
        easing: 'cubic-bezier(.34,1.4,.5,1)'
      }
    )
  }
  let synced = false,
    syncTimers = []
  btn.addEventListener('click', () => {
    syncTimers.forEach(clearTimeout)
    syncTimers = []
    if (synced) {
      devs.forEach((d) => d.classList.remove('synced'))
      lists.forEach((l, i) => (l.innerHTML = initial[i]))
      totals.forEach((t) => (t.textContent = btn.dataset.before))
      btn.textContent = label
      synced = false
      return
    }
    synced = true
    const steps = [
      () => {
        phone.classList.add('synced')
        totals[1].textContent = btn.dataset.after
        insertFirst(lists[1], 'sync-row')
      },
      () => {
        laptop.classList.add('synced')
        totals[0].textContent = btn.dataset.after
        insertFirst(lists[0], 'sync-figure')
      },
      () => devs[2].classList.add('synced')
    ]
    steps.forEach((f, i) => syncTimers.push(setTimeout(f, reduce ? 0 : i * 700)))
    syncTimers.push(setTimeout(() => (btn.textContent = 'Reset'), reduce ? 0 : 1500))
  })
})()
