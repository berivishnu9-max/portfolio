import { useEffect, useRef, useState } from 'react'

// Frames are pre-extracted by tools/build-portrait.sh and drawn straight to a
// canvas, so the head tracks the pointer on the next animation frame. (Seeking
// a <video> is asynchronous and always trails the pointer.)
//   follow: head turns left -> up -> right, mapped to pointer X
//   react:  turns to the viewer and smiles, played on click
const base = `${import.meta.env.BASE_URL}portrait/`
const FOLLOW_FRAMES = 61
const REACT_FRAMES = 37
const ASPECT = 960 / 878
const REACT_FPS = 24
const REACT_HOLD_MS = 1400
const FADE_MS = 220
// How quickly the head catches up with the pointer (ms time constant).
const EASE_MS = 55
const CACHE_SIZE = 20

const frameUrl = (set: 'follow' | 'react', i: number) =>
  `${base}${set}/${String(i).padStart(3, '0')}.webp`

const GREETINGS = [
  'Hi! Nice to meet you 👋',
  "Let's solve something together.",
  'Ask me about process mapping.',
  'My CV is one click away ↓',
]

const WIDE_QUERY = '(min-aspect-ratio: 1/1)'

type Mode =
  | { kind: 'follow' }
  | { kind: 'react'; start: number }
  | { kind: 'return'; start: number }

export default function Portrait() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const reactRef = useRef<() => void>(() => {})
  const [ready, setReady] = useState(false)
  const [wide, setWide] = useState(() => window.matchMedia(WIDE_QUERY).matches)
  const [bubble, setBubble] = useState<{ text: string; key: number } | null>(null)
  const greetIndex = useRef(0)

  useEffect(() => {
    const mq = window.matchMedia(WIDE_QUERY)
    const onChange = () => setWide(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let disposed = false
    const blobs = {
      follow: new Array<Blob | undefined>(FOLLOW_FRAMES),
      react: new Array<Blob | undefined>(REACT_FRAMES),
    }
    // Decoded frames are large (~3 MB each), so keep only a small LRU of them;
    // the compressed blobs stay in memory and decode in a few milliseconds.
    const cache = new Map<string, ImageBitmap>()
    const pending = new Set<string>()

    const decode = (set: 'follow' | 'react', i: number) => {
      const key = `${set}${i}`
      const blob = blobs[set][i]
      if (!blob || cache.has(key) || pending.has(key)) return
      pending.add(key)
      createImageBitmap(blob)
        .then((bmp) => {
          pending.delete(key)
          if (disposed) return bmp.close()
          cache.set(key, bmp)
          while (cache.size > CACHE_SIZE) {
            const oldest = cache.keys().next().value as string
            const old = cache.get(oldest)
            cache.delete(oldest)
            // Frames still on screen or mid-fade are left for the GC.
            if (old && old !== last && old !== fadeFrom) old.close()
          }
          dirty = true
        })
        .catch(() => pending.delete(key))
    }

    const get = (set: 'follow' | 'react', i: number) => {
      const key = `${set}${i}`
      const bmp = cache.get(key)
      if (bmp) {
        cache.delete(key) // refresh LRU position
        cache.set(key, bmp)
        return bmp
      }
      decode(set, i)
      return undefined
    }

    const load = (set: 'follow' | 'react', count: number) =>
      Promise.all(
        Array.from({ length: count }, (_, i) =>
          fetch(frameUrl(set, i))
            .then((r) => (r.ok ? r.blob() : undefined))
            .then((b) => {
              blobs[set][i] = b
            })
            .catch(() => {}),
        ),
      )

    // Follow frames first so the head responds as soon as possible.
    load('follow', FOLLOW_FRAMES).then(() => {
      if (disposed) return
      decode('follow', 0)
      load('react', REACT_FRAMES)
    })

    let target = 0
    let pos = 0
    let mode: Mode = { kind: 'follow' }
    let last: ImageBitmap | undefined
    let fadeFrom: ImageBitmap | undefined
    let fadeStart = 0
    let dirty = true
    let prev = performance.now()
    let raf = 0
    let visible = true
    let shown = false

    const size = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(canvas.clientWidth * dpr)
      canvas.height = Math.round(canvas.clientHeight * dpr)
      dirty = true
    }
    size()
    const ro = new ResizeObserver(size)
    ro.observe(canvas)

    const draw = (img: ImageBitmap | undefined, alpha = 1) => {
      if (!img) return
      ctx.globalAlpha = alpha
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    }

    const startFade = (now: number) => {
      fadeFrom = last
      fadeStart = now
    }

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      const dt = now - prev
      prev = now
      if (!visible) return

      const before = pos
      pos += (target - pos) * (1 - Math.exp(-dt / EASE_MS))
      if (Math.abs(pos - before) > 0.0005) dirty = true

      // Pick the frame(s) for this moment.
      let a: ImageBitmap | undefined
      let b: ImageBitmap | undefined
      let mix = 0
      if (mode.kind === 'react') {
        const f = Math.floor(((now - mode.start) / 1000) * REACT_FPS)
        if (f >= REACT_FRAMES + (REACT_HOLD_MS / 1000) * REACT_FPS) {
          mode = { kind: 'return', start: now }
          startFade(now)
        } else {
          const idx = Math.min(f, REACT_FRAMES - 1)
          a = get('react', idx) ?? last
          if (idx + 1 < REACT_FRAMES) decode('react', idx + 1)
          dirty = true
        }
      }
      if (mode.kind !== 'react') {
        const i0 = Math.max(0, Math.min(FOLLOW_FRAMES - 1, Math.floor(pos)))
        const i1 = Math.min(FOLLOW_FRAMES - 1, i0 + 1)
        mix = pos - i0
        a = get('follow', i0)
        b = i1 !== i0 ? get('follow', i1) : undefined
        // Prefetch around where the pointer is heading.
        const t = Math.round(target)
        for (let d = -2; d <= 2; d++) {
          const k = t + d
          if (k >= 0 && k < FOLLOW_FRAMES) decode('follow', k)
        }
        if (!a) a = last
        if (mode.kind === 'return' && now - mode.start > FADE_MS) mode = { kind: 'follow' }
      }

      const fading = fadeFrom && now - fadeStart < FADE_MS
      if (!dirty && !fading) return
      dirty = false

      ctx.clearRect(0, 0, canvas.width, canvas.height)
      draw(a)
      if (b && mix > 0.01) draw(b, mix) // blend neighbours for sub-frame smoothness
      if (fading) draw(fadeFrom, 1 - (now - fadeStart) / FADE_MS)
      else fadeFrom = undefined
      ctx.globalAlpha = 1
      if (a) {
        last = a
        if (!shown) {
          shown = true
          setReady(true)
        }
      }
    }
    raf = requestAnimationFrame(tick)

    // The clip turns from looking left to looking right, so pointer X maps
    // straight onto the frame index: the head follows the cursor.
    const follow = (x: number) => {
      const ratio = Math.min(Math.max(x / window.innerWidth, 0), 1)
      target = ratio * (FOLLOW_FRAMES - 1)
    }
    const onMouseMove = (e: MouseEvent) => follow(e.clientX)
    const onTouch = (e: TouchEvent) => follow(e.touches[0].clientX)

    reactRef.current = () => {
      const now = performance.now()
      if (mode.kind === 'react') return
      startFade(now)
      mode = { kind: 'react', start: now }
      for (let i = 0; i < 4; i++) decode('react', i)
    }

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      dirty = true
    })
    io.observe(canvas)

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('touchstart', onTouch, { passive: true })
    window.addEventListener('touchmove', onTouch, { passive: true })
    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      ro.disconnect()
      io.disconnect()
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('touchstart', onTouch)
      window.removeEventListener('touchmove', onTouch)
      cache.forEach((bmp) => bmp.close())
      cache.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onActivate = () => {
    reactRef.current()
    const text = GREETINGS[greetIndex.current % GREETINGS.length]
    greetIndex.current += 1
    setBubble({ text, key: Date.now() })
  }

  useEffect(() => {
    if (!bubble) return
    const t = window.setTimeout(() => setBubble(null), 2600)
    return () => window.clearTimeout(t)
  }, [bubble])

  // Wide screens: portrait anchored bottom-right, left shoulder faded out.
  // Portrait screens: across the top, bottom edge faded under the copy.
  const frameStyle: React.CSSProperties = wide
    ? {
        right: 0,
        bottom: 0,
        width: `min(${(85 * ASPECT).toFixed(1)}vh, 58vw)`,
        maskImage: 'linear-gradient(to right, transparent 0, #000 22%)',
        WebkitMaskImage: 'linear-gradient(to right, transparent 0, #000 22%)',
      }
    : {
        top: 56,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'min(100vw, 60vh)',
        maskImage: 'linear-gradient(to bottom, #000 72%, transparent 100%)',
        WebkitMaskImage: 'linear-gradient(to bottom, #000 72%, transparent 100%)',
      }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Say hello"
      onClick={onActivate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onActivate()
        }
      }}
      className="absolute z-0 cursor-pointer select-none outline-none focus-visible:ring-2 focus-visible:ring-gold"
      style={{ ...frameStyle, aspectRatio: `${ASPECT}` }}
    >
      <img
        src={frameUrl('follow', 0)}
        alt=""
        aria-hidden="true"
        draggable={false}
        className="absolute inset-0 h-full w-full"
        style={{ opacity: ready ? 0 : 1 }}
      />
      <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0 h-full w-full" />

      <div
        aria-live="polite"
        className="pointer-events-none absolute"
        style={{ left: wide ? '30%' : '8%', top: wide ? '4%' : '2%' }}
      >
        {bubble && (
          <span
            key={bubble.key}
            className="portrait-bubble inline-block whitespace-nowrap rounded-full border border-solid border-gold bg-white px-4 py-2 text-[14px] text-charcoal shadow-[0_8px_24px_rgba(44,48,46,0.12)] sm:text-[16px]"
          >
            {bubble.text}
          </span>
        )}
      </div>
    </div>
  )
}
