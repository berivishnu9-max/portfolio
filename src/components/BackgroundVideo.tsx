import { useEffect, useRef, useState } from 'react'

// Two crops of the same clip (backdrop keyed to the page canvas by
// tools/key-backdrop.py), padded with the canvas colour so the subject sits
// clear of the text: on the right for wide screens, at the top for phones.
// Both are encoded with a 2-frame keyframe interval so seeks land quickly.
const base = import.meta.env.BASE_URL
const SOURCES = {
  wide: { src: `${base}hero-wide.mp4`, poster: `${base}hero-wide.jpg` },
  tall: { src: `${base}hero-tall.mp4`, poster: `${base}hero-tall.jpg` },
}
const WIDE_QUERY = '(min-aspect-ratio: 1/1)'

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

    // The clip turns from looking left to looking right, so pointer X maps
    // straight onto time: the head follows the cursor across the screen.
    const follow = (x: number) => {
      if (window.scrollY > window.innerHeight) return // hero scrolled away
      const duration = video.duration
      if (!duration || Number.isNaN(duration)) return
      const ratio = Math.min(Math.max(x / window.innerWidth, 0), 1)
      targetTime = ratio * duration
      if (!seeking) seek()
    }

    // A source swap (e.g. rotating a tablet) restarts the clip at 0.
    const onLoaded = () => {
      targetTime = video.currentTime
    }

    const onMouseMove = (e: MouseEvent) => follow(e.clientX)
    const onTouchMove = (e: TouchEvent) => follow(e.touches[0].clientX)

    video.addEventListener('seeked', onSeeked)
    video.addEventListener('loadedmetadata', onLoaded)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('touchmove', onTouchMove, { passive: true })
    window.addEventListener('touchstart', onTouchMove, { passive: true })
    return () => {
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('loadedmetadata', onLoaded)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchstart', onTouchMove)
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
      className="absolute inset-0 z-0 h-full w-full object-cover"
      style={{ objectPosition: wide ? '70% center' : '70% top' }}
    />
  )
}
