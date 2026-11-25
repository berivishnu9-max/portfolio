import Lenis from 'lenis'
import 'lenis/dist/lenis.css'

/*
 * Smooth, inertial page scrolling (Lenis), skipped when the visitor prefers reduced motion.
 * The instance is shared on window.__lenis so the page script in index.html can route its
 * anchor jumps and pause scrolling while a case study is open.
 */
declare global {
  interface Window {
    __lenis?: Lenis
  }
}

export function startSmoothScroll() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const lenis = new Lenis({ lerp: 0.09, wheelMultiplier: 1, smoothWheel: true, autoRaf: true })
  window.__lenis = lenis
  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => {
    if (e.matches) {
      lenis.destroy()
      window.__lenis = undefined
    }
  })
}
