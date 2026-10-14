import { useRef } from 'react'
import Character from './components/Character'
import Navbar from './components/Navbar'
import Hero from './components/Hero'

export default function App() {
  const heroRef = useRef<HTMLElement>(null)
  return (
    <section ref={heroRef} id="hero" aria-label="Introduction" className="hero-section bg-charcoal text-canvas">
      <Character heroRef={heroRef} />
      <Navbar />
      <Hero />
    </section>
  )
}
