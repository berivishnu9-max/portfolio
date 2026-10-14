import { useEffect, useRef } from 'react'

/*
 * Cursor-tracking character built from layered 2D art (tools/build-character.py),
 * not a rigged 3D model:
 *   - irises are separate discs, moved per eye toward the pointer and clipped
 *     to the eye openings; the real upper lids are drawn over them
 *   - blinks sweep a sprite of the real lid skin and lash line down and up
 *   - the head turns by a small depth-weighted image warp in WebGL; the
 *     torso, shoulders and background stay fixed
 * Everything is driven from one requestAnimationFrame loop. No React state
 * changes after mount.
 */

type Eye = {
  box: [number, number, number, number]
  iris: [number, number]
  radius: number
  irisSize: number
  highlights: [number, number, number][]
  rangeX: number
  rangeUp: number
  rangeDown: number
}
type Meta = { width: number; height: number; lidSteps: number; eyes: Eye[] }

const base = `${import.meta.env.BASE_URL}character/`

// Behaviour tuning.
const EYE_TAU = 45 // ms: eyes lead...
const HEAD_FREQ = 1.6 // Hz: ...the head follows on a lightly damped spring
const HEAD_DAMP = 0.86
const MAX_YAW = 0.62 // rad of gaze that maps to the edge of the iris range
const MAX_PITCH = 0.5
const HEAD_SHARE = 0.32 // fraction of the gaze the head takes over
const HEAD_MAX_X = 11 // px (art scale) head shift at full yaw
const HEAD_MAX_Y = 6
const TOUCH_RELEASE_MS = 1200
const SHOULDER_SHARE = 0.22 // shoulders follow a fraction of the head shift
const BREATH_PX = 1.8 // art px the upper body rises on an in-breath
const BREATH_MS = 4600 // average breath period
const IDLE_AFTER_MS = 2500 // with no pointer, start occasional idle glances

// Head region for the warp, in art pixels (measured on the frame).
const HEAD_C = [765, 470]
const HEAD_R = [430, 480]
const NOSE = [752, 600]
const NECK_Y = [830, 950]
// Upper-body region: everything above BODY_Y[0] moves with the shoulders and
// breathing; the effect fades to nothing at the bottom edge of the art.
const BODY_Y = [900, 1290]

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`

const FRAG = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uBase;
uniform sampler2D uEyes;
uniform vec2 uSize;      // art size in px
uniform vec4 uEyesRect;  // x, y, w, h in px
uniform vec2 uHead;      // head shift in px
uniform vec2 uBody;      // shoulder + breathing shift in px
void main() {
  vec2 p = vUv * uSize;
  // Weight: 1 on the head, 0 on the neck, shirt and background.
  float e = length((p - vec2(${HEAD_C[0]}.0, ${HEAD_C[1]}.0)) / vec2(${HEAD_R[0]}.0, ${HEAD_R[1]}.0));
  float w = 1.0 - smoothstep(0.78, 1.08, e);
  w *= 1.0 - smoothstep(${NECK_Y[0]}.0, ${NECK_Y[1]}.0, p.y);
  // Pseudo-depth: the nose and eyes move more than the outline -> a turn, not a slide.
  float depth = 0.45 + 0.55 * (1.0 - smoothstep(0.0, 1.0, length((p - vec2(${NOSE[0]}.0, ${NOSE[1]}.0)) / 360.0)));
  // One smooth displacement field, so head, neck and shoulders never separate.
  float body = 1.0 - smoothstep(${BODY_Y[0]}.0, ${BODY_Y[1]}.0, p.y);
  vec2 src = p - uBody * body - uHead * w * depth;
  vec2 q = (src - uEyesRect.xy) / uEyesRect.zw;
  vec4 c = texture2D(uBase, src / uSize);
  if (q.x >= 0.0 && q.y >= 0.0 && q.x <= 1.0 && q.y <= 1.0) {
    vec4 eyes = texture2D(uEyes, q);
    c = vec4(mix(c.rgb, eyes.rgb, eyes.a), 1.0);
  }
  gl_FragColor = vec4(c.rgb, 1.0);
}`

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

const expApproach = (cur: number, target: number, dt: number, tau: number) =>
  cur + (target - cur) * (1 - Math.exp(-dt / tau))

export default function Character({ heroRef }: { heroRef: React.RefObject<HTMLElement> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const hero = heroRef.current
    if (!canvas || !hero) return
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, premultipliedAlpha: false })
    if (!gl) return // the static poster stays visible

    let disposed = false
    let raf = 0
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

    const run = async () => {
      const meta: Meta = await fetch(`${base}character.json`).then((r) => r.json())
      const [baseImg, ...layers] = await Promise.all([
        loadImage(`${base}base.webp`),
        ...meta.eyes.flatMap((_, n) =>
          ['iris', 'open', 'shade', 'lid'].map((k) => loadImage(`${base}${k}-${n}.png`)),
        ),
      ])
      if (disposed) return
      const eyes = meta.eyes.map((e, n) => {
        const [irisImg, openImg, shadeImg, lidImg] = layers.slice(n * 4, n * 4 + 4)
        const scratch = document.createElement('canvas')
        scratch.width = e.box[2]
        scratch.height = e.box[3]
        return {
          ...e, irisImg, openImg, shadeImg, lidImg, scratch, sctx: scratch.getContext('2d')!,
          ox: 0, oy: 0, // current iris offset (px)
        }
      })

      // Offscreen canvas holding just the eye region; uploaded each frame.
      const ex0 = Math.min(...eyes.map((e) => e.box[0]))
      const ey0 = Math.min(...eyes.map((e) => e.box[1]))
      const ex1 = Math.max(...eyes.map((e) => e.box[0] + e.box[2]))
      const ey1 = Math.max(...eyes.map((e) => e.box[1] + e.box[3]))
      const eyeCanvas = document.createElement('canvas')
      eyeCanvas.width = ex1 - ex0
      eyeCanvas.height = ey1 - ey0
      const ectx = eyeCanvas.getContext('2d')!

      // --- WebGL setup ---------------------------------------------------------
      const compile = (type: number, src: string) => {
        const s = gl.createShader(type)!
        gl.shaderSource(s, src)
        gl.compileShader(s)
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader')
        return s
      }
      const prog = gl.createProgram()!
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT))
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG))
      gl.linkProgram(prog)
      gl.useProgram(prog)
      const buf = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, buf)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
      const aPos = gl.getAttribLocation(prog, 'aPos')
      gl.enableVertexAttribArray(aPos)
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)
      const texture = (unit: number, src: TexImageSource) => {
        const t = gl.createTexture()
        gl.activeTexture(gl.TEXTURE0 + unit)
        gl.bindTexture(gl.TEXTURE_2D, t)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src)
        return t
      }
      texture(0, baseImg)
      const eyeTex = texture(1, eyeCanvas)
      const u = (name: string) => gl.getUniformLocation(prog, name)
      gl.uniform1i(u('uBase'), 0)
      gl.uniform1i(u('uEyes'), 1)
      gl.uniform2f(u('uSize'), meta.width, meta.height)
      gl.uniform4f(u('uEyesRect'), ex0, ey0, eyeCanvas.width, eyeCanvas.height)
      const uHead = u('uHead')
      const uBody = u('uBody')

      const resize = () => {
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        canvas.width = Math.round(canvas.clientWidth * dpr)
        canvas.height = Math.round(canvas.clientHeight * dpr)
        gl.viewport(0, 0, canvas.width, canvas.height)
      }
      resize()
      const ro = new ResizeObserver(resize)
      ro.observe(canvas)

      // --- Input ---------------------------------------------------------------
      // Pointer position in viewport px, or null when it is outside the hero.
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
      // Mouse and pen use pointer events. Touch uses touch events, which keep
      // firing while the browser pans (pointer events are cancelled then).
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

      // --- Blinks --------------------------------------------------------------
      // Human-like: mostly every 2-6 s (skewed), sometimes a quick double blink.
      const CLOSE_MS = 75
      const HOLD_MS = 35
      const OPEN_MS = 125
      const nextGap = () => Math.min(7000, Math.max(1300, 1600 - Math.log(Math.random()) * 1900))
      let blinkAt = performance.now() + 900 + Math.random() * 1500
      let blinkStart = -1
      let doubleQueued = false
      const lidAmount = (now: number) => {
        if (blinkStart < 0 && now >= blinkAt) {
          blinkStart = now
        }
        if (blinkStart < 0) return 0
        const t = now - blinkStart
        if (t < CLOSE_MS) return t / CLOSE_MS
        if (t < CLOSE_MS + HOLD_MS) return 1
        if (t < CLOSE_MS + HOLD_MS + OPEN_MS) return 1 - (t - CLOSE_MS - HOLD_MS) / OPEN_MS
        blinkStart = -1
        if (!doubleQueued && Math.random() < 0.16) {
          doubleQueued = true
          blinkAt = now + 110 + Math.random() * 90
        } else {
          doubleQueued = false
          blinkAt = now + nextGap()
        }
        return 0
      }

      // --- Loop ----------------------------------------------------------------
      let gazeYaw = 0
      let gazePitch = 0
      let headYaw = 0
      let headYawV = 0
      let headPitchV = 0
      // Idle behaviour: occasional small glances, often back to the viewer.
      let idleYaw = 0
      let idlePitch = 0.04
      let idleNext = 0
      // Breathing: phase advances with a slightly varying period.
      let breathPhase = Math.random() * Math.PI * 2
      let breathPeriod = BREATH_MS
      let headPitch = 0
      let prev = performance.now()
      let visible = true
      const io = new IntersectionObserver(([en]) => (visible = en.isIntersecting))
      io.observe(canvas)

      const tick = (now: number) => {
        raf = requestAnimationFrame(tick)
        const dt = Math.min(64, now - prev)
        prev = now
        if (!visible) return

        // Screen geometry of the art (the canvas shows the whole art, letterbox-free).
        const rect = canvas.getBoundingClientRect()
        const scale = rect.width / meta.width
        // Viewing distance: ~2 face-widths, so a cursor on the face is a real angle.
        const dist = 2.1 * 620 * scale

        // Target gaze angles, per eye, from the pointer (or rest).
        let tYaw = 0
        let tPitch = 0
        const motionOn = !reduceMotion.matches
        if (!pointer && motionOn && now - lastActive > IDLE_AFTER_MS && now > idleNext) {
          const toViewer = Math.random() < 0.45
          idleYaw = toViewer ? 0 : (Math.random() * 2 - 1) * 0.16
          idlePitch = toViewer ? 0.04 : -0.05 + Math.random() * 0.13
          idleNext = now + 1800 + Math.random() * 2700
        }
        const idle = !pointer && motionOn && now - lastActive > IDLE_AFTER_MS
        const perEye = eyes.map((e) => {
          if (!pointer) return idle ? [idleYaw, idlePitch] : [0, 0.04] // rest: at the viewer, a touch low
          const ex = rect.left + e.iris[0] * scale
          const ey = rect.top + e.iris[1] * scale
          return [Math.atan2(pointer.x - ex, dist), Math.atan2(pointer.y - ey, dist)]
        })
        perEye.forEach(([y, p]) => {
          tYaw += y / perEye.length
          tPitch += p / perEye.length
        })

        // Head takes a share of the gaze, slowly; eyes cover the rest, quickly.
        // Damped spring: settles naturally with a hint of follow-through.
        const w0 = 2 * Math.PI * HEAD_FREQ
        const step = (x: number, v: number, target: number) => {
          const h = dt / 1000
          const a = w0 * w0 * (target - x) - 2 * HEAD_DAMP * w0 * v
          const nv = v + a * h
          return [x + nv * h, nv]
        }
        ;[headYaw, headYawV] = step(headYaw, headYawV, motionOn ? tYaw * HEAD_SHARE : 0)
        ;[headPitch, headPitchV] = step(headPitch, headPitchV, motionOn ? tPitch * HEAD_SHARE : 0)
        gazeYaw = expApproach(gazeYaw, tYaw, dt, EYE_TAU)
        gazePitch = expApproach(gazePitch, tPitch, dt, EYE_TAU)

        const lid = lidAmount(now)
        const lidIndex = Math.round(Math.min(1, Math.max(0, lid)) * (meta.lidSteps - 1))

        ectx.clearRect(0, 0, eyeCanvas.width, eyeCanvas.height)
        eyes.forEach((e, n) => {
          // Each eye aims from its own position (slight convergence near the face),
          // minus what the head has already turned. tanh keeps edges natural.
          const yawE = gazeYaw + (perEye[n][0] - tYaw) - headYaw
          const pitE = gazePitch + (perEye[n][1] - tPitch) - headPitch
          const gx = Math.tanh(yawE / MAX_YAW)
          const gy = Math.tanh(pitE / MAX_PITCH)
          e.ox = gx * e.rangeX
          e.oy = gy * (gy > 0 ? e.rangeDown : e.rangeUp)

          const [bx, by, bw, bh] = e.box
          const s = e.sctx
          s.globalCompositeOperation = 'source-over'
          s.clearRect(0, 0, bw, bh)
          const cx = e.iris[0] + e.ox - bx
          const cy = e.iris[1] + e.oy - by
          s.drawImage(e.irisImg, cx - e.irisSize / 2, cy - e.irisSize / 2)
          for (const [hx, hy, hr] of e.highlights) {
            const g = s.createRadialGradient(cx + hx, cy + hy, 0, cx + hx, cy + hy, hr)
            g.addColorStop(0, 'rgba(255,255,255,0.95)')
            g.addColorStop(0.7, 'rgba(255,255,255,0.85)')
            g.addColorStop(1, 'rgba(255,255,255,0)')
            s.fillStyle = g
            s.beginPath()
            s.arc(cx + hx, cy + hy, hr, 0, Math.PI * 2)
            s.fill()
          }
          s.globalCompositeOperation = 'destination-in'
          s.drawImage(e.openImg, 0, 0)
          s.globalCompositeOperation = 'source-over'
          s.drawImage(e.shadeImg, 0, 0)
          s.drawImage(e.lidImg, 0, lidIndex * bh, bw, bh, 0, 0, bw, bh)
          ectx.drawImage(e.scratch, bx - ex0, by - ey0)
        })

        gl.activeTexture(gl.TEXTURE1)
        gl.bindTexture(gl.TEXTURE_2D, eyeTex)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, eyeCanvas)
        const hx = Math.max(-1, Math.min(1, headYaw / (MAX_YAW * HEAD_SHARE))) * HEAD_MAX_X
        const hy = Math.max(-1, Math.min(1, headPitch / (MAX_PITCH * HEAD_SHARE))) * HEAD_MAX_Y
        gl.uniform2f(uHead, hx, hy)
        // Shoulders follow the head a little; breathing lifts the upper body.
        let breath = 0
        if (motionOn) {
          breathPhase += (dt / breathPeriod) * Math.PI * 2
          if (breathPhase > Math.PI * 2) {
            breathPhase -= Math.PI * 2
            breathPeriod = BREATH_MS * (0.85 + Math.random() * 0.3)
          }
          breath = -BREATH_PX * (0.5 - 0.5 * Math.cos(breathPhase))
        }
        const bx = hx * SHOULDER_SHARE
        const by = hy * SHOULDER_SHARE * 0.5 + breath
        gl.uniform2f(uBody, bx, by)
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
        canvas.dataset.ready = '1'
        // Exposed for automated checks only (read-only snapshot).
        canvas.dataset.state = `${eyes.map((e) => `${e.ox.toFixed(1)},${e.oy.toFixed(1)}`).join(';')}|${headYaw.toFixed(3)},${headPitch.toFixed(3)}|${lidIndex}|${bx.toFixed(2)},${by.toFixed(2)}`
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

    let cleanup = () => {}
    run().catch((err) => console.error('character:', err))
    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      cleanup()
    }
  }, [heroRef])

  return (
    <div
      aria-hidden="true"
      className="character pointer-events-none z-0"
    >
      <img
        src={`${base}poster.webp`}
        alt=""
        draggable={false}
        className="absolute inset-0 h-full w-full"
      />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
    </div>
  )
}
