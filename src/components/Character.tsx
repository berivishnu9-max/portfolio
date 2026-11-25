import { useEffect, useState } from 'react'
import ClipCharacter from './ClipCharacter'
import SpriteCharacter from './SpriteCharacter'

/*
 * The hero character. With the video-derived clips built (tools/build-clips.py writes
 * public/clips/manifest.json) he is the live avatar: real in-between frames for every
 * head turn and a looping idle. Without them, the sprite character built from the nine
 * drawn poses is used, so the site works at every stage.
 */
export default function Character({ heroRef }: { heroRef: React.RefObject<HTMLElement> }) {
  const [mode, setMode] = useState<'pending' | 'clips' | 'sprites'>('pending')
  useEffect(() => {
    let alive = true
    fetch(`${import.meta.env.BASE_URL}clips/manifest.json`)
      .then((r) => (r.ok && (r.headers.get('content-type') ?? '').includes('json') ? r.json() : Promise.reject()))
      .then(() => alive && setMode('clips'))
      .catch(() => alive && setMode('sprites'))
    return () => {
      alive = false
    }
  }, [])
  if (mode === 'pending') return <div aria-hidden="true" className="character pointer-events-none z-0" />
  return mode === 'clips' ? <ClipCharacter heroRef={heroRef} /> : <SpriteCharacter heroRef={heroRef} />
}
