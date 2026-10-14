import { useEffect, useRef } from 'react'

/*
 * Cursor-following character drawn from two 3x3 sheets (tools/build-mascot.py):
 * nine head directions and nine expressions. The pointer's angle from the face
 * picks one of eight directions, or the front-facing pose when it is close to the
 * face. Consecutive poses cross-fade, so a turn reads as a movement rather than a
 * cut. Clicking or tapping the head plays an expression. Every frame shares the
 * same shoulders (aligned at build time), so only the head and face change.
 * One requestAnimationFrame loop, which only draws while something is changing.
 */

type Manifest = { tile: number; face: [number, number]; directions: string[]; reactions: string[] }

const base = `${import.meta.env.BASE_URL}mascot/`
const FADE_MS = 120 // cross-fade between two poses
const DEAD_ZONE = 0.14 // pointer this close to the face (x character height) = look at the viewer
const STICKY = (12 * Math.PI) / 180 // keep the current direction until the pointer is this far past its sector edge
const HOLD_MS = 1300 // how long an expression stays up
const IDLE_AFTER_MS = 3500
const SLEEP_AFTER_MS = 30000
const TOUCH_RELEASE_MS = 1200
const HEAD_RADIUS = 0.24 // clickable circle round the face, x character height

// Directions sheet order (row by row) and the compass angle each one stands for.
const FRONT = 4
const SECTORS: [number, number][] = [
  [5, 0], // right
  [8, 45], // down-right
  [7, 90], // down
  [6, 135], // down-left
  [3, 180], // left
  [0, -135], // up-left
  [1, -90], // up
  [2, -45], // up-right
]
// Expressions sheet indices (offset by 9 in the combined frame list).
const R = { blink: 9, heart: 10, sparkle: 11, surprised: 12, bright: 13, bashful: 14, sleepy: 15, dizzy: 16, delighted: 17 }
// "bright" is left out: it is almost the resting face, so a click on it looks like nothing happened.
const CLICK_ORDER = [R.heart, R.delighted, R.surprised, R.sparkle, R.bashful]

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

function angleDiff(a: number, b: number) {
  const d = Math.abs(a - b) % (2 * Math.PI)
  return d > Math.PI ? 2 * Math.PI - d : d
}

export default function Character({ heroRef }: { heroRef: React.RefObject<HTMLElement> }) {
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
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

    const run = async () => {
      const manifest: Manifest = await fetch(`${base}manifest.json`).then((r) => r.json())
      const [dirs, reacts] = await Promise.all([loadImage(`${base}directions.webp`), loadImage(`${base}reactions.webp`)])
      await Promise.all([dirs.decode().catch(() => {}), reacts.decode().catch(() => {})])
      if (disposed) return
      const T = manifest.tile
      const [faceX, faceY] = manifest.face

      const resize = () => {
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        canvas.width = Math.round(canvas.clientWidth * dpr)
        canvas.height = Math.round(canvas.clientHeight * dpr)
        dirty = true
      }

      // --- Pose state ------------------------------------------------------------
      let shown = FRONT // frame on screen (0-8 directions, 9-17 expressions)
      let from = FRONT // frame being faded out
      let fadeStart = -Infinity
      let fadeMs = FADE_MS
      let dirty = true
      let lookDir = FRONT // last direction chosen from the pointer
      let reaction = -1
      let reactionUntil = 0
      const clicks: number[] = []
      let clickTurn = 0

      const show = (frame: number, now: number, ms = FADE_MS) => {
        if (frame === shown) return
        // Mid-fade, start the next fade from whichever frame dominates.
        const k = (now - fadeStart) / fadeMs
        from = k < 0.5 && k >= 0 ? from : shown
        shown = frame
        fadeMs = ms
        fadeStart = reduceMotion.matches ? -Infinity : now
        dirty = true
      }

      // --- Input -------------------------------------------------------------------
      let pointer: { x: number; y: number } | null = null
      let lastActive = performance.now()
      let releaseTimer = 0
      const faceAt = () => {
        const r = canvas.getBoundingClientRect()
        return { x: r.left + r.width * faceX, y: r.top + r.height * faceY, h: r.height }
      }
      const inHero = (x: number, y: number) => {
        const r = hero.getBoundingClientRect()
        return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
      }
      const onHead = (x: number, y: number) => {
        const f = faceAt()
        return Math.hypot(x - f.x, y - f.y) < f.h * HEAD_RADIUS
      }
      const track = (x: number, y: number) => {
        pointer = inHero(x, y) ? { x, y } : null
        lastActive = performance.now()
        hero.style.cursor = pointer && onHead(x, y) ? 'pointer' : ''
      }
      const react = (x: number, y: number, target: EventTarget | null) => {
        if (target instanceof Element && target.closest('a, button, input, textarea, select, [role="button"]')) return
        if (!onHead(x, y)) return
        const now = performance.now()
        lastActive = now
        if (reaction === R.dizzy && now < reactionUntil) return // let him recover first
        clicks.push(now)
        while (clicks.length && now - clicks[0] > 1600) clicks.shift()
        if (clicks.length >= 4) {
          reaction = R.dizzy
          clicks.length = 0
        } else {
          reaction = CLICK_ORDER[clickTurn++ % CLICK_ORDER.length]
        }
        reactionUntil = now + (reaction === R.dizzy ? HOLD_MS + 600 : HOLD_MS)
        show(reaction, now)
      }
      const onMove = (e: PointerEvent) => {
        if (e.pointerType !== 'touch') track(e.clientX, e.clientY)
      }
      const onDown = (e: PointerEvent) => {
        if (e.pointerType !== 'touch') track(e.clientX, e.clientY)
        if (e.button === 0) react(e.clientX, e.clientY, e.target)
      }
      const onTouch = (e: TouchEvent) => {
        window.clearTimeout(releaseTimer)
        const t = e.touches[0]
        if (t) track(t.clientX, t.clientY)
      }
      const onTouchEnd = () => {
        releaseTimer = window.setTimeout(() => (pointer = null), TOUCH_RELEASE_MS)
      }
      const onLeave = () => {
        pointer = null
        hero.style.cursor = ''
      }
      const onScroll = () => {
        if (pointer && !inHero(pointer.x, pointer.y)) pointer = null
      }
      window.addEventListener('pointermove', onMove, { passive: true })
      window.addEventListener('pointerdown', onDown, { passive: true })
      window.addEventListener('touchstart', onTouch, { passive: true })
      window.addEventListener('touchmove', onTouch, { passive: true })
      window.addEventListener('touchend', onTouchEnd, { passive: true })
      window.addEventListener('touchcancel', onTouchEnd, { passive: true })
      document.documentElement.addEventListener('pointerleave', onLeave)
      window.addEventListener('blur', onLeave)
      window.addEventListener('scroll', onScroll, { passive: true })

      // --- Blinks and idle glances ---------------------------------------------------
      const nextBlink = () => 2600 + Math.random() * 4200
      let blinkAt = performance.now() + 2000
      let blinkUntil = 0
      let idlePose = FRONT
      let idleNext = 0

      let visible = true
      const io = new IntersectionObserver(([en]) => (visible = en.isIntersecting))
      io.observe(canvas)
      resize()
      const ro = new ResizeObserver(resize)
      ro.observe(canvas)

      const drawFrame = (frame: number, alpha: number) => {
        if (alpha <= 0) return
        const sheet = frame < 9 ? dirs : reacts
        const i = frame % 9
        ctx.globalAlpha = alpha
        ctx.drawImage(sheet, (i % 3) * T, Math.floor(i / 3) * T, T, T, 0, 0, canvas.width, canvas.height)
      }

      const tick = (now: number) => {
        raf = requestAnimationFrame(tick)
        if (!visible) return
        const motionOn = !reduceMotion.matches

        // Which pose should be up right now?
        let target = FRONT
        if (reaction >= 0 && now < reactionUntil) {
          target = reaction
        } else {
          reaction = -1
          if (pointer && motionOn) {
            const f = faceAt()
            const dx = pointer.x - f.x
            const dy = pointer.y - f.y
            if (Math.hypot(dx, dy) > f.h * DEAD_ZONE) {
              const a = Math.atan2(dy, dx)
              const cur = SECTORS.find(([d]) => d === lookDir)
              // Stay on the current direction until the pointer is clearly past it.
              if (!cur || angleDiff(a, (cur[1] * Math.PI) / 180) > Math.PI / 8 + STICKY) {
                let best = SECTORS[0]
                for (const s of SECTORS) if (angleDiff(a, (s[1] * Math.PI) / 180) < angleDiff(a, (best[1] * Math.PI) / 180)) best = s
                lookDir = best[0]
              }
            } else lookDir = FRONT
            target = lookDir
          } else if (motionOn && now - lastActive > SLEEP_AFTER_MS) {
            target = R.sleepy
          } else if (motionOn && now - lastActive > IDLE_AFTER_MS) {
            if (now > idleNext) {
              const r = Math.random()
              idlePose = r < 0.5 ? FRONT : r < 0.65 ? 3 : r < 0.8 ? 5 : r < 0.9 ? 0 : 2
              idleNext = now + 1800 + Math.random() * 2800
            }
            target = idlePose
          } else {
            lookDir = FRONT
          }
          // A blink is the expression sheet's closed-eye smile, only from the front.
          if (now >= blinkAt) {
            if (motionOn && target === FRONT && shown === FRONT) blinkUntil = now + 130
            blinkAt = now + (blinkUntil > now ? nextBlink() : 700)
          }
          if (now < blinkUntil && target === FRONT) target = R.blink
        }
        show(target, now, target === R.blink || shown === R.blink ? 55 : FADE_MS)

        const k = Math.min(1, (now - fadeStart) / fadeMs)
        if (!dirty && k >= 1) return
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        if (k < 1 && from !== shown) {
          // 'lighter' adds the two premultiplied frames, so where both are opaque
          // the sum stays opaque: a true cross-dissolve with no see-through dip.
          ctx.globalCompositeOperation = 'lighter'
          drawFrame(from, 1 - k)
          drawFrame(shown, k)
          ctx.globalCompositeOperation = 'source-over'
        } else {
          drawFrame(shown, 1)
        }
        ctx.globalAlpha = 1
        dirty = k < 1
        canvas.dataset.ready = '1'
        if (canvas.parentElement) canvas.parentElement.dataset.ready = '1'
        // Read-only snapshot for automated checks.
        canvas.dataset.state = shown < 9 ? manifest.directions[shown] : manifest.reactions[shown - 9]
      }
      raf = requestAnimationFrame(tick)

      cleanup = () => {
        ro.disconnect()
        io.disconnect()
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerdown', onDown)
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

    run().catch((err) => console.error('character:', err))
    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      cleanup()
    }
  }, [heroRef])

  return (
    <div aria-hidden="true" className="character pointer-events-none z-0">
      {/* Front-facing pose straight from the atlas, shown until the canvas takes over. */}
      <div className="character-poster absolute inset-0" style={{ backgroundImage: `url(${base}directions.webp)` }} />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
    </div>
  )
}
