import { useEffect, useRef } from 'react'
import Character from './components/Character'
import Navbar from './components/Navbar'
import Hero from './components/Hero'
import { scrollToHash } from './lib/scroll'

export default function App() {
  const heroRef = useRef<HTMLElement>(null)
  // The hint goes away once the visitor has clicked or tapped, or after a few seconds.
  useEffect(() => {
    const done = () => heroRef.current?.classList.add('hint-done')
    const timer = window.setTimeout(done, 7000)
    window.addEventListener('click', done, { once: true })
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('click', done)
    }
  }, [])
  return (
    <section ref={heroRef} id="hero" aria-label="Introduction" className="hero-section bg-charcoal text-canvas">
      <Character heroRef={heroRef} />
      <Navbar />
      <Hero />
      <p className="hero-hint" aria-hidden="true">
        <span className="hint-mouse">Move your mouse. Click him.</span>
        <span className="hint-touch">Tap him.</span>
      </p>
      <a href="#work" onClick={scrollToHash} className="hero-scroll">
        Selected work <span aria-hidden="true">↓</span>
      </a>
    </section>
  )
}
