import { useEffect, useRef } from 'react'

/*
 * The live avatar, played from real video frames (tools/build-clips.py).
 *
 * Each of the eight head directions is a path of frames from the front pose out to that
 * direction, and the idle clip is a loop of him blinking and moving a little. The pointer
 * picks the direction and how far along its path to go; the position eases on a spring,
 * and the two nearest frames are blended, so a turn is as smooth as the video it came from.
 * He only changes direction through the front pose, so he never cuts between two turns.
 * With the pointer at rest near him (or absent) the idle loop plays, so he is never frozen.
 * Clicking his head plays an expression from the sprite sheet; the shoulders are pinned
 * in every frame at build time, so only the head and face ever move.
 *
 * One requestAnimationFrame loop; it pauses while the hero is off screen.
 */

type Clip = { frames: number; cols: number; fps?: number }
type Manifest = { tile: number; paths: Record<string, Clip>; idle: Clip }
type Mascot = { tile: number; face: [number, number]; reactions: string[] }
type Sheet = { img: HTMLImageElement; clip: Clip }

const clipBase = `${import.meta.env.BASE_URL}clips/`
const mascotBase = `${import.meta.env.BASE_URL}mascot/`
const DEAD_ZONE = 0.08 // pointer this close to the face (screen fraction) means "look at me"
const SWITCH_AT = 0.06 // direction changes only below this extent, i.e. through the front pose
const IDLE_BLEND = 0.1 // how much extent it takes to fade the idle loop out
const REACT_FADE_MS = 140
const HOLD_MS = 1300
const TOUCH_RELEASE_MS = 1200
const SPRING = { w: 11, z: 1 } // critically damped: quick, no overshoot
const HEAD = { cy: 0.43, rx: 0.27, ry: 0.31 } // clickable ellipse, fractions of the height

// Compass angle (degrees, y down) each path stands for.
const SECTORS: [string, number][] = [
  ['right', 0], ['down-right', 45], ['down', 90], ['down-left', 135],
  ['left', 180], ['up-left', -135], ['up', -90], ['up-right', -45],
]
// Reactions sheet order; blink and bright are left out of the click cycle.
const CLICK_ORDER = [1, 8, 3, 2, 5] // heart, delighted, surprised, sparkle, bashful
const DIZZY = 7

const load = (src: string) =>
  new Promise<HTMLImageElement>((ok, bad) => {
    const i = new Image()
    i.decoding = 'async'
    i.onload = () => ok(i)
    i.onerror = bad
    i.src = src
  })

const angleDiff = (a: number, b: number) => {
  const d = Math.abs(a - b) % (2 * Math.PI)
  return d > Math.PI ? 2 * Math.PI - d : d
}

export default function ClipCharacter({ heroRef }: { heroRef: React.RefObject<HTMLElement> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const hero = heroRef.current
    if (!canvas || !hero) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let disposed = false
    let raf = 0
    let cleanup = () => {}
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')

    const run = async () => {
      const [man, mas]: [Manifest, Mascot] = await Promise.all([
        fetch(`${clipBase}manifest.json`).then((r) => r.json()),
        fetch(`${mascotBase}manifest.json`).then((r) => r.json()),
      ])
      const T = man.tile
      const names = Object.keys(man.paths)
      const [idleImg, reactImg, ...pathImgs] = await Promise.all([
        load(`${clipBase}idle.webp`),
        load(`${mascotBase}reactions.webp`),
        ...names.map((n) => load(`${clipBase}${n}.webp`)),
      ])
      await Promise.all([idleImg, reactImg, ...pathImgs].map((i) => i.decode().catch(() => {})))
      if (disposed) return
      const idle: Sheet = { img: idleImg, clip: man.idle }
      const paths: Record<string, Sheet> = Object.fromEntries(names.map((n, i) => [n, { img: pathImgs[i], clip: man.paths[n] }]))
      const [faceX, faceY] = mas.face

      const resize = () => {
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        const w = Math.round(canvas.clientWidth * dpr)
        const h = Math.round(canvas.clientHeight * dpr)
        if (w === canvas.width && h === canvas.height) return
        canvas.width = w
        canvas.height = h
        frame(performance.now())
      }

      // --- Input ---------------------------------------------------------------
      let pointer: { x: number; y: number } | null = null
      let lastActive = performance.now()
      let releaseTimer = 0
      const inHero = (x: number, y: number) => {
        const r = hero.getBoundingClientRect()
        return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
      }
      const faceAt = () => {
        const r = canvas.getBoundingClientRect()
        return { x: r.left + r.width * faceX, y: r.top + r.height * faceY, h: r.height }
      }
      const onHead = (x: number, y: number) => {
        const r = canvas.getBoundingClientRect()
        const dx = (x - (r.left + r.width * faceX)) / (r.height * HEAD.rx)
        const dy = (y - (r.top + r.height * HEAD.cy)) / (r.height * HEAD.ry)
        return dx * dx + dy * dy < 1
      }
      const blocked = (t: EventTarget | null) =>
        t instanceof Element && !!t.closest('a, button, input, textarea, select, [role="button"], #mobile-menu')
      const track = (x: number, y: number, target: EventTarget | null = null) => {
        pointer = inHero(x, y) ? { x, y } : null
        lastActive = performance.now()
        hero.style.cursor = pointer && !blocked(target) && onHead(x, y) ? 'pointer' : ''
      }
      let reaction = -1
      let reactionAt = 0
      let clickTurn = 0
      const clicks: number[] = []
      const react = (x: number, y: number, target: EventTarget | null) => {
        if (blocked(target) || !onHead(x, y)) return
        const now = performance.now()
        lastActive = now
        if (reaction === DIZZY && now - reactionAt < HOLD_MS + 600) return
        clicks.push(now)
        while (clicks.length && now - clicks[0] > 1600) clicks.shift()
        reaction = clicks.length >= 4 ? DIZZY : CLICK_ORDER[clickTurn++ % CLICK_ORDER.length]
        if (reaction === DIZZY) clicks.length = 0
        reactionAt = now
      }
      const onMove = (e: PointerEvent) => e.pointerType !== 'touch' && track(e.clientX, e.clientY, e.target)
      const onClick = (e: MouseEvent) => e.button === 0 && e.detail > 0 && react(e.clientX, e.clientY, e.target)
      const onMouseDown = (e: MouseEvent) => {
        if (e.button === 0 && !blocked(e.target) && onHead(e.clientX, e.clientY)) e.preventDefault()
      }
      const onTouch = (e: TouchEvent) => {
        window.clearTimeout(releaseTimer)
        const t = e.touches[0]
        if (t) track(t.clientX, t.clientY)
      }
      const onTouchEnd = () => (releaseTimer = window.setTimeout(() => (pointer = null), TOUCH_RELEASE_MS))
      const onLeave = () => {
        pointer = null
        hero.style.cursor = ''
      }
      const onScroll = () => {
        if (pointer && !inHero(pointer.x, pointer.y)) pointer = null
      }
      window.addEventListener('pointermove', onMove, { passive: true })
      window.addEventListener('click', onClick)
      window.addEventListener('mousedown', onMouseDown)
      window.addEventListener('touchstart', onTouch, { passive: true })
      window.addEventListener('touchmove', onTouch, { passive: true })
      window.addEventListener('touchend', onTouchEnd, { passive: true })
      window.addEventListener('touchcancel', onTouchEnd, { passive: true })
      document.documentElement.addEventListener('pointerleave', onLeave)
      window.addEventListener('blur', onLeave)
      window.addEventListener('scroll', onScroll, { passive: true })

      // --- Motion state ----------------------------------------------------------
      let dir = 'left'
      let extent = 0
      let vel = 0
      let prev = performance.now()
      const t0 = prev

      const drawTile = (s: Sheet, i: number, alpha: number) => {
        if (alpha <= 0.001) return
        ctx.globalAlpha = alpha
        ctx.drawImage(s.img, (i % s.clip.cols) * T, Math.floor(i / s.clip.cols) * T, T, T, 0, 0, canvas.width, canvas.height)
      }

      function frame(now: number) {
        const w = canvas!.width
        const h = canvas!.height
        ctx!.clearRect(0, 0, w, h)
        ctx!.globalCompositeOperation = 'lighter' // weights sum to 1, so blended frames stay opaque
        const motion = !reduce.matches
        const react = reaction >= 0 && now - reactionAt < HOLD_MS + (reaction === DIZZY ? 600 : 0)
        if (!react) reaction = -1
        const fade = react ? Math.min(1, (now - reactionAt) / REACT_FADE_MS) : 0
        const outFade = react ? Math.min(1, (reactionAt + HOLD_MS - now) / REACT_FADE_MS) : 0
        const rw = Math.max(0, Math.min(fade, outFade < 1 ? outFade : 1))

        // idle loop position: frames advance with time and blend with the next one
        const fi = motion ? (((now - t0) / 1000) * (idle.clip.fps ?? 12)) % idle.clip.frames : 0
        const i0 = Math.floor(fi)
        const i1 = (i0 + 1) % idle.clip.frames
        const m = fi - i0
        const wIdle = Math.max(0, 1 - extent / IDLE_BLEND) * (1 - rw)
        drawTile(idle, i0, wIdle * (1 - m))
        drawTile(idle, i1, wIdle * m)

        const wPath = (1 - wIdle) * (1 - rw)
        if (wPath > 0.001) {
          const p = paths[dir] ?? paths[names[0]]
          const pos = Math.max(0, Math.min(1, extent)) * (p.clip.frames - 1)
          const a = Math.floor(pos)
          const b = Math.min(p.clip.frames - 1, a + 1)
          drawTile(p, a, wPath * (1 - (pos - a)))
          drawTile(p, b, wPath * (pos - a))
        }
        if (rw > 0.001) {
          ctx!.globalAlpha = rw
          ctx!.drawImage(reactImg, (reaction % 3) * mas.tile, Math.floor(reaction / 3) * mas.tile, mas.tile, mas.tile, 0, 0, w, h)
        }
        ctx!.globalCompositeOperation = 'source-over'
        ctx!.globalAlpha = 1
        canvas!.dataset.ready = '1'
        if (canvas!.parentElement) canvas!.parentElement.dataset.ready = '1'
        canvas!.dataset.state = react ? `reaction-${reaction}` : `${dir}|${extent.toFixed(2)}`
      }

      const tick = (now: number) => {
        raf = requestAnimationFrame(tick)
        const dt = Math.min(0.05, (now - prev) / 1000)
        prev = now
        if (!visible) return
        const motion = !reduce.matches
        let target = 0
        let tDir = dir
        if (pointer && motion) {
          const f = faceAt()
          const dx = (pointer.x - f.x) / Math.max(1, window.innerWidth * 0.45)
          const dy = (pointer.y - f.y) / Math.max(1, window.innerHeight * 0.45)
          const mag = Math.hypot(dx, dy)
          if (mag > DEAD_ZONE) {
            const ang = Math.atan2(dy, dx)
            let best = SECTORS[0]
            for (const s of SECTORS) if (angleDiff(ang, (s[1] * Math.PI) / 180) < angleDiff(ang, (best[1] * Math.PI) / 180)) best = s
            tDir = best[0]
            target = Math.min(1, (mag - DEAD_ZONE) / (1 - DEAD_ZONE))
          }
        } else if (motion && now - lastActive > 2500) {
          target = 0 // at rest: the idle loop plays
        }
        // Change direction only through the front pose, so two turns are never cut together.
        if (tDir !== dir) {
          if (extent < SWITCH_AT && paths[tDir]) dir = tDir
          else target = 0
        }
        // critically damped spring toward the target extent
        const acc = SPRING.w * SPRING.w * (target - extent) - 2 * SPRING.z * SPRING.w * vel
        vel += acc * dt
        extent = Math.max(0, Math.min(1, extent + vel * dt))
        frame(now)
      }

      let visible = true
      const io = new IntersectionObserver(([en]) => (visible = en.isIntersecting))
      io.observe(canvas)
      const ro = new ResizeObserver(resize)
      ro.observe(canvas)
      resize()
      raf = requestAnimationFrame(tick)

      cleanup = () => {
        ro.disconnect()
        io.disconnect()
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('click', onClick)
        window.removeEventListener('mousedown', onMouseDown)
        window.removeEventListener('touchstart', onTouch)
        window.removeEventListener('touchmove', onTouch)
        window.removeEventListener('touchend', onTouchEnd)
        window.removeEventListener('touchcancel', onTouchEnd)
        document.documentElement.removeEventListener('pointerleave', onLeave)
        window.removeEventListener('blur', onLeave)
        window.removeEventListener('scroll', onScroll)
        window.clearTimeout(releaseTimer)
        hero.style.cursor = ''
      }
    }

    run().catch((err) => console.error('character (clips):', err))
    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      cleanup()
    }
  }, [heroRef])

  return (
    <div aria-hidden="true" className="character pointer-events-none z-0">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
    </div>
  )
}
