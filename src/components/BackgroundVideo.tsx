import { useEffect, useRef, useState } from 'react'

// Two crops of the same clip, padded with the backdrop red so the subject sits
// clear of the text: on the right for wide screens, at the top for phones.
// Both are encoded with a 3-frame keyframe interval so seeks land quickly.
const base = import.meta.env.BASE_URL
const SOURCES = {
  wide: { src: `${base}hero-wide.mp4`, poster: `${base}hero-wide.jpg` },
  tall: { src: `${base}hero-tall.mp4`, poster: `${base}hero-tall.jpg` },
}
const WIDE_QUERY = '(min-aspect-ratio: 1/1)'
const SENSITIVITY = 0.8

export default function BackgroundVideo() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [wide, setWide] = useState(() => window.matchMedia(WIDE_QUERY).matches)

  useEffect(() => {
    const mq = window.matchMedia(WIDE_QUERY)
    const onChange = () => setWide(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const { src, poster } = wide ? SOURCES.wide : SOURCES.tall

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    let prevX: number | null = null
    let targetTime = 0
    let seeking = false

    const seek = () => {
      if (Math.abs(video.currentTime - targetTime) < 0.001) return
      seeking = true
      video.currentTime = targetTime
    }

    // Queue the next seek only once the previous one lands, so fast mouse
    // movement doesn't flood the decoder with seeks.
    const onSeeked = () => {
      seeking = false
      if (Math.abs(video.currentTime - targetTime) > 0.001) seek()
    }

    const scrub = (x: number) => {
      if (prevX === null) {
        prevX = x
        return
      }
      const delta = x - prevX
      prevX = x
      const duration = video.duration
      if (!duration || Number.isNaN(duration)) return
      const offset = (delta / window.innerWidth) * SENSITIVITY * duration
      targetTime = Math.min(Math.max(targetTime + offset, 0), duration)
      if (!seeking) seek()
    }

    // A source swap (e.g. rotating a tablet) restarts the clip at 0.
    const onLoaded = () => {
      targetTime = video.currentTime
    }

    const onMouseMove = (e: MouseEvent) => scrub(e.clientX)
    const onTouchMove = (e: TouchEvent) => scrub(e.touches[0].clientX)
    const onTouchEnd = () => {
      prevX = null
    }

    video.addEventListener('seeked', onSeeked)
    video.addEventListener('loadedmetadata', onLoaded)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('touchmove', onTouchMove, { passive: true })
    window.addEventListener('touchend', onTouchEnd)
    return () => {
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('loadedmetadata', onLoaded)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
    }
  }, [])

  return (
    <video
      ref={videoRef}
      src={src}
      poster={poster}
      muted
      playsInline
      preload="auto"
      aria-hidden="true"
      tabIndex={-1}
      className="fixed inset-0 z-0 h-full w-full object-cover"
      style={{ objectPosition: wide ? '70% center' : '70% top' }}
    />
  )
}
