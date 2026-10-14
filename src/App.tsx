import Portrait from './components/Portrait'
import Navbar from './components/Navbar'
import Hero from './components/Hero'

export default function App() {
  return (
    <section id="hero" className="relative h-screen overflow-hidden bg-canvas text-charcoal">
      <Portrait />
      <Navbar />
      <Hero />
    </section>
  )
}
