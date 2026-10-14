import { useEffect, useRef } from 'react'

/*
 * Cursor-following character played from real video frames (tools/build-veo-character.py).
 * Each direction is a "path" of frames that starts at the same front-facing
 * pose and runs out to an extreme (left, right, up, down). The pointer picks the
 * dominant direction and how far along it to go; the head eases along the path
 * and only changes path when it is back near the centre, so it never cuts
 * between two different poses. Neighbouring frames are cross-faded for
 * sub-frame smoothness. Blinks play the blink path forwards and back.
 * One requestAnimationFrame loop; no React state after mount.
 */

type Manifest = { size: number; backdrop: string; paths: Record<string, string[]> }
type Dir = 'left' | 'right' | 'up' | 'down'

const base = `${import.meta.env.BASE_URL}face/`
const EASE_MS = 120 // how quickly the head follows the pointer
const SWITCH_AT = 0.06 // path changes only below this extent (near the centre)
const DEAD_ZONE = 0.08 // pointer this close to the face centre means "look at me"
const IDLE_AFTER_MS = 3000
const TOUCH_RELEASE_MS = 1200

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

export default function Character({ heroRef }: { heroRef: React.RefObject<HTMLElement> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const hero = heroRef.current
    if (!canvas || !hero) return
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) return

    let disposed = false
    let raf = 0
    let cleanup = () => {}
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

    const run = async () => {
      const manifest: Manifest = await fetch(`${base}manifest.json`).then((r) => r.json())
      const names = Object.keys(manifest.paths)
      const loaded = await Promise.all(
        names.map((n) => Promise.all(manifest.paths[n].map((f) => loadImage(`${base}${f}`)))),
      )
      if (disposed) return
      const paths = Object.fromEntries(names.map((n, i) => [n, loaded[i]])) as Record<string, HTMLImageElement[]>
      // Decode up front so the first move never stutters.
      await Promise.all(Object.values(paths).flat().map((im) => im.decode().catch(() => {})))
      if (disposed) return

      const resize = () => {
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        canvas.width = Math.round(canvas.clientWidth * dpr)
        canvas.height = Math.round(canvas.clientHeight * dpr)
      }
      resize()
      const ro = new ResizeObserver(resize)
      ro.observe(canvas)

      // --- Input -------------------------------------------------------------
      let pointer: { x: number; y: number } | null = null
      let lastActive = performance.now()
      let releaseTimer = 0
      const inHero = (x: number, y: number) => {
        const r = hero.getBoundingClientRect()
        return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
      }
      const track = (x: number, y: number) => {
        pointer = inHero(x, y) ? { x, y } : null
        lastActive = performance.now()
      }
      const onMove = (e: PointerEvent) => {
        if (e.pointerType !== 'touch') track(e.clientX, e.clientY)
      }
      const onTouch = (e: TouchEvent) => {
        window.clearTimeout(releaseTimer)
        const t = e.touches[0]
        if (t) track(t.clientX, t.clientY)
      }
      const onTouchEnd = () => {
        releaseTimer = window.setTimeout(() => (pointer = null), TOUCH_RELEASE_MS)
      }
      const onLeave = () => (pointer = null)
      const onScroll = () => {
        if (pointer && !inHero(pointer.x, pointer.y)) pointer = null
      }
      window.addEventListener('pointermove', onMove, { passive: true })
      window.addEventListener('pointerdown', onMove, { passive: true })
      window.addEventListener('touchstart', onTouch, { passive: true })
      window.addEventListener('touchmove', onTouch, { passive: true })
      window.addEventListener('touchend', onTouchEnd, { passive: true })
      window.addEventListener('touchcancel', onTouchEnd, { passive: true })
      document.documentElement.addEventListener('pointerleave', onLeave)
      window.addEventListener('blur', onLeave)
      window.addEventListener('scroll', onScroll, { passive: true })

      // --- Blinks: varied gaps, occasional double, never mid-turn ----------------
      const blinkFrames = paths.blink ?? []
      const nextGap = () => Math.min(7000, Math.max(1800, 2000 - Math.log(Math.random()) * 2200))
      let blinkAt = performance.now() + 1500 + Math.random() * 2000
      let blinkStart = -1
      let blinkDur = 260
      let doubleQueued = false

      // --- State ---------------------------------------------------------------
      let dir: Dir = 'left'
      let extent = 0 // 0 = centre, 1 = end of the current path
      let idleDir: Dir = 'left'
      let idleExt = 0
      let idleNext = 0
      let prev = performance.now()
      let visible = true
      const io = new IntersectionObserver(([en]) => (visible = en.isIntersecting))
      io.observe(canvas)

      const draw = (img: HTMLImageElement, alpha: number) => {
        ctx.globalAlpha = alpha
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      }

      const tick = (now: number) => {
        raf = requestAnimationFrame(tick)
        const dt = Math.min(64, now - prev)
        prev = now
        if (!visible) return
        const motionOn = !reduceMotion.matches

        // Target direction and extent from the pointer, relative to the face.
        let tDir: Dir = dir
        let tExt = 0
        if (pointer && motionOn) {
          const r = canvas.getBoundingClientRect()
          const fx = r.left + r.width * 0.5
          const fy = r.top + r.height * 0.3
          const dx = (pointer.x - fx) / Math.max(1, window.innerWidth * 0.45)
          const dy = (pointer.y - fy) / Math.max(1, window.innerHeight * 0.45)
          const mag = Math.hypot(dx, dy)
          if (mag > DEAD_ZONE) {
            tDir = Math.abs(dx) >= Math.abs(dy) * 1.15 ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down'
            tExt = Math.min(1, (mag - DEAD_ZONE) / (1 - DEAD_ZONE))
          }
        } else if (motionOn && now - lastActive > IDLE_AFTER_MS) {
          // Idle: an occasional small glance, mostly back to the viewer.
          if (now > idleNext) {
            const r = Math.random()
            idleDir = r < 0.4 ? 'left' : r < 0.75 ? 'right' : 'up'
            idleExt = Math.random() < 0.45 ? 0 : 0.25 + Math.random() * 0.3
            idleNext = now + 2000 + Math.random() * 3000
          }
          tDir = idleDir
          tExt = idleExt
        }

        // Only switch path through the centre; otherwise head back first.
        if (tDir !== dir) {
          if (extent < SWITCH_AT) dir = tDir
          else tExt = 0
        }
        extent += (tExt - extent) * (1 - Math.exp(-dt / EASE_MS))

        const frames = paths[dir]
        const pos = extent * (frames.length - 1)
        const i0 = Math.floor(pos)
        const i1 = Math.min(frames.length - 1, i0 + 1)
        const mix = pos - i0

        // Blink only when the head is near the centre (the blink frames are frontal).
        if (blinkStart < 0 && now >= blinkAt) {
          if (extent < 0.15 && motionOn && blinkFrames.length) {
            blinkStart = now
            blinkDur = 220 + Math.random() * 90
          } else blinkAt = now + 400
        }
        let blinkImg: HTMLImageElement | null = null
        let blinkAlpha = 0
        if (blinkStart >= 0) {
          const t = (now - blinkStart) / blinkDur
          if (t >= 1) {
            blinkStart = -1
            if (!doubleQueued && Math.random() < 0.15) {
              doubleQueued = true
              blinkAt = now + 120 + Math.random() * 100
            } else {
              doubleQueued = false
              blinkAt = now + nextGap()
            }
          } else {
            // Close fast, open a little slower.
            const k = t < 0.4 ? t / 0.4 : 1 - (t - 0.4) / 0.6
            const bp = k * (blinkFrames.length - 1)
            blinkImg = blinkFrames[Math.round(bp)]
            blinkAlpha = Math.min(1, extent < 0.15 ? 1 : 0)
          }
        }

        ctx.globalAlpha = 1
        draw(frames[i0], 1)
        if (mix > 0.02 && i1 !== i0) draw(frames[i1], mix)
        if (blinkImg) draw(blinkImg, blinkAlpha)
        ctx.globalAlpha = 1

        canvas.dataset.ready = '1'
        // Read-only snapshot for automated checks.
        canvas.dataset.state = `${dir}|${extent.toFixed(3)}|${blinkImg ? 1 : 0}`
      }
      raf = requestAnimationFrame(tick)

      cleanup = () => {
        ro.disconnect()
        io.disconnect()
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerdown', onMove)
        window.removeEventListener('touchstart', onTouch)
        window.removeEventListener('touchmove', onTouch)
        window.removeEventListener('touchend', onTouchEnd)
        window.removeEventListener('touchcancel', onTouchEnd)
        document.documentElement.removeEventListener('pointerleave', onLeave)
        window.removeEventListener('blur', onLeave)
        window.removeEventListener('scroll', onScroll)
        window.clearTimeout(releaseTimer)
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
      <img src={`${base}left-00.webp`} alt="" draggable={false} className="absolute inset-0 h-full w-full" />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
    </div>
  )
}
