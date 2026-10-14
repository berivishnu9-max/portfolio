import { useEffect, useRef } from 'react'

/*
 * Cursor-following character drawn from two 3x3 sheets (tools/build-mascot.py):
 * nine head directions and nine expressions. The pointer's angle from the face
 * picks one of eight directions, or the front-facing pose when it is close to the
 * face. Consecutive poses cross-fade. Clicking or tapping the head plays an expression.
 *
 * To make him feel alive between those drawings, each frame is split at the neck:
 * the shoulders are drawn still, and the head layer above them moves continuously -
 * it eases toward the pointer, tilts the way it looks, sways and bobs a little when
 * idle, and bounces when clicked - on springs, so every motion is smooth. Every frame
 * shares the same shoulders (aligned at build time), so the body never moves.
 * One requestAnimationFrame loop; it pauses when the hero is off screen.
 */

type Manifest = { tile: number; face: [number, number]; directions: string[]; reactions: string[] }

const base = `${import.meta.env.BASE_URL}mascot/`
const FADE_MS = 160 // cross-fade between two poses
const DEAD_ZONE = 0.14 // pointer this close to the face (x character height) = look at the viewer
const STICKY = (12 * Math.PI) / 180 // keep the current direction until the pointer is this far past its sector edge
const HOLD_MS = 1300 // how long an expression stays up
const IDLE_AFTER_MS = 3500
const SLEEP_AFTER_MS = 30000
const TOUCH_RELEASE_MS = 1200
// Clickable ellipse round the whole head (hair to beard), as fractions of the character height.
const HEAD = { cy: 0.43, rx: 0.27, ry: 0.31 }
// The head layer is fully the head above NECK.top and fully the (still) body below
// NECK.bottom; it turns about PIVOT, at the base of the neck, where nothing visibly moves.
const NECK = { top: 0.66, bottom: 0.8 }
const PIVOT = { x: 0.5, y: 0.8 }
// How far the head leans toward the pointer: shift as a fraction of the size, tilt in degrees.
const LEAN = { x: 0.012, y: 0.01, roll: 2.5 }
const SPRING = { w: 9, z: 0.72 } // natural frequency (rad/s) and damping: smooth, with a little life

type Spring = { x: number; v: number }
function stepSpring(s: Spring, target: number, dt: number) {
  const a = SPRING.w * SPRING.w * (target - s.x) - 2 * SPRING.z * SPRING.w * s.v
  s.v += a * dt
  s.x += s.v * dt
}

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

      // Offscreen layers: the cross-faded frame, then its head and body halves.
      const layer = () => {
        const c = document.createElement('canvas')
        return [c, c.getContext('2d')!] as const
      }
      const [frameC, fctx] = layer()
      const [headC, hctx] = layer()
      const [bodyC, bctx] = layer()
      let headMask: CanvasGradient | null = null
      let bodyMask: CanvasGradient | null = null

      const resize = () => {
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        const w = Math.round(canvas.clientWidth * dpr)
        const h = Math.round(canvas.clientHeight * dpr)
        if (w === canvas.width && h === canvas.height) return
        for (const c of [canvas, frameC, headC, bodyC]) {
          c.width = w // resizing clears the bitmap...
          c.height = h
        }
        const g = (from: number, to: number) => {
          const m = hctx.createLinearGradient(0, h * NECK.top, 0, h * NECK.bottom)
          m.addColorStop(0, `rgba(0,0,0,${from})`)
          m.addColorStop(1, `rgba(0,0,0,${to})`)
          return m
        }
        headMask = g(1, 0)
        bodyMask = g(0, 1)
        paint(performance.now()) // ...so redraw before the browser paints, or it flashes blank
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
      // Continuous head motion, each axis on its own spring.
      const sx: Spring = { x: 0, v: 0 }
      const sy: Spring = { x: 0, v: 0 }
      const sr: Spring = { x: 0, v: 0 }
      let prev = performance.now()
      const t0 = prev

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
        const r = canvas.getBoundingClientRect()
        const dx = (x - (r.left + r.width * faceX)) / (r.height * HEAD.rx)
        const dy = (y - (r.top + r.height * HEAD.cy)) / (r.height * HEAD.ry)
        return dx * dx + dy * dy < 1
      }
      // Something else is in the way: a link or button, or the open phone menu over the head.
      const blocked = (target: EventTarget | null) =>
        target instanceof Element &&
        !!target.closest('a, button, input, textarea, select, [role="button"], #mobile-menu')
      const updateCursor = (target: EventTarget | null = null) => {
        hero.style.cursor = pointer && !blocked(target) && onHead(pointer.x, pointer.y) ? 'pointer' : ''
      }
      const track = (x: number, y: number, target: EventTarget | null = null) => {
        pointer = inHero(x, y) ? { x, y } : null
        lastActive = performance.now()
        updateCursor(target)
      }
      const react = (x: number, y: number, target: EventTarget | null) => {
        if (blocked(target) || !onHead(x, y)) return
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
        if (!reduceMotion.matches) sy.v -= 0.09 // the head pops up a little, then settles
      }
      const onMove = (e: PointerEvent) => {
        if (e.pointerType !== 'touch') track(e.clientX, e.clientY, e.target)
      }
      const onDown = (e: PointerEvent) => {
        if (e.pointerType !== 'touch') track(e.clientX, e.clientY, e.target)
      }
      // Expressions start on click, not pointerdown: a swipe that begins on the face is a
      // scroll, and the browser sends no click for it. Keyboard-made clicks (detail 0) are
      // for the buttons they land on.
      const onClick = (e: MouseEvent) => {
        if (e.button === 0 && e.detail > 0) react(e.clientX, e.clientY, e.target)
      }
      // Rapid clicks on the head (four make him dizzy) must not select the hero text.
      const onMouseDown = (e: MouseEvent) => {
        if (e.button === 0 && !blocked(e.target) && onHead(e.clientX, e.clientY)) e.preventDefault()
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
        updateCursor() // the head moved under a still mouse
      }
      window.addEventListener('pointermove', onMove, { passive: true })
      window.addEventListener('pointerdown', onDown, { passive: true })
      window.addEventListener('click', onClick)
      window.addEventListener('mousedown', onMouseDown)
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
      const ro = new ResizeObserver(resize)
      ro.observe(canvas)
      // A move to a screen with another pixel ratio changes no CSS size, so watch for it.
      let dprQuery: MediaQueryList | null = null
      const watchDpr = () => {
        dprQuery?.removeEventListener('change', onDpr)
        dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
        dprQuery.addEventListener('change', onDpr)
      }
      const onDpr = () => {
        resize()
        watchDpr()
      }
      watchDpr()

      function drawFrame(frame: number, alpha: number) {
        if (alpha <= 0) return
        const sheet = frame < 9 ? dirs : reacts
        const i = frame % 9
        fctx.globalAlpha = alpha
        fctx.drawImage(sheet, (i % 3) * T, Math.floor(i / 3) * T, T, T, 0, 0, frameC.width, frameC.height)
      }

      const tick = (now: number) => {
        raf = requestAnimationFrame(tick)
        const dt = Math.min(0.05, (now - prev) / 1000)
        prev = now
        if (!visible) return
        const motionOn = !reduceMotion.matches

        // Where the head leans: toward the pointer, continuously (not just per pose).
        let lx = 0
        let ly = 0
        if (pointer && motionOn && !(reaction >= 0 && now < reactionUntil)) {
          const f = faceAt()
          lx = Math.max(-1, Math.min(1, (pointer.x - f.x) / (window.innerWidth * 0.5)))
          ly = Math.max(-1, Math.min(1, (pointer.y - f.y) / (window.innerHeight * 0.5)))
        }

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
            // glances lean the same way the face turns
            lx = idlePose === 3 || idlePose === 0 ? -0.5 : idlePose === 5 || idlePose === 2 ? 0.5 : 0
            ly = idlePose === 0 || idlePose === 2 ? -0.4 : 0
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

        if (motionOn) {
          // A slow, uneven sway and bob, so he never freezes; smaller while he is looking at something.
          const t = (now - t0) / 1000
          const calm = pointer ? 0.5 : 1
          const sway = calm * (Math.sin(t * 1.21) * 0.7 + Math.sin(t * 0.53 + 1.3) * 0.3)
          const bob = calm * Math.sin(t * 1.63 + 0.4) * 0.004
          const dizzy = reaction === R.dizzy && now < reactionUntil ? Math.sin(t * 9) * 4 : 0
          stepSpring(sx, lx * LEAN.x, dt)
          stepSpring(sy, ly * LEAN.y + bob, dt)
          stepSpring(sr, lx * LEAN.roll + sway + dizzy, dt)
          paint(now)
        } else {
          sx.x = sy.x = sr.x = sx.v = sy.v = sr.v = 0
          if (dirty || now - fadeStart < fadeMs) paint(now)
        }
      }

      let layersFor = '' // which frame mix the head/body layers currently hold
      function paint(now: number) {
        const k = Math.min(1, (now - fadeStart) / fadeMs)
        const w = canvas!.width
        const h = canvas!.height
        // The layers only change when the pose does; a moving head just re-composites them.
        const mix = k < 1 && from !== shown ? `${from}>${shown}@${k.toFixed(3)}` : `${shown}`
        const key = `${mix}|${w}x${h}`
        if (key !== layersFor) {
          layersFor = key
          buildLayers(k, w, h)
        }
        ctx!.clearRect(0, 0, w, h)
        ctx!.drawImage(bodyC, 0, 0)
        const px = w * PIVOT.x
        const py = h * PIVOT.y
        ctx!.save()
        ctx!.translate(px + sx.x * w, py + sy.x * h)
        ctx!.rotate((sr.x * Math.PI) / 180)
        ctx!.translate(-px, -py)
        ctx!.drawImage(headC, 0, 0)
        ctx!.restore()
        dirty = k < 1
        canvas!.dataset.ready = '1'
        if (canvas!.parentElement) canvas!.parentElement.dataset.ready = '1'
        // Read-only snapshot for automated checks.
        canvas!.dataset.state = shown < 9 ? manifest.directions[shown] : manifest.reactions[shown - 9]
        canvas!.dataset.head = `${(sx.x * w).toFixed(1)},${(sy.x * h).toFixed(1)},${sr.x.toFixed(2)}`
      }

      function buildLayers(k: number, w: number, h: number) {
        fctx.clearRect(0, 0, w, h)
        if (k < 1 && from !== shown) {
          // 'lighter' adds the two premultiplied frames, so where both are opaque
          // the sum stays opaque: a true cross-dissolve with no see-through dip.
          fctx.globalCompositeOperation = 'lighter'
          drawFrame(from, 1 - k)
          drawFrame(shown, k)
          fctx.globalCompositeOperation = 'source-over'
        } else {
          drawFrame(shown, 1)
        }
        fctx.globalAlpha = 1

        // Split at the neck with complementary masks: untransformed, they add back up
        // to exactly the frame.
        for (const [c, mask] of [[hctx, headMask], [bctx, bodyMask]] as const) {
          c.clearRect(0, 0, w, h)
          c.drawImage(frameC, 0, 0)
          if (mask) {
            c.globalCompositeOperation = 'destination-in'
            c.fillStyle = mask
            c.fillRect(0, 0, w, h)
            c.globalCompositeOperation = 'source-over'
          }
        }
      }
      resize()
      raf = requestAnimationFrame(tick)

      cleanup = () => {
        ro.disconnect()
        io.disconnect()
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerdown', onDown)
        window.removeEventListener('click', onClick)
        window.removeEventListener('mousedown', onMouseDown)
        dprQuery?.removeEventListener('change', onDpr)
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
