// Smooth in-page navigation for links rendered by React (the page script in
// index.html only wires up anchors that exist at load). Honours reduced motion
// and moves focus to the target so keyboard users land in the section.
export function scrollToHash(e: React.MouseEvent<HTMLAnchorElement>) {
  const href = e.currentTarget.getAttribute('href') ?? ''
  if (!href.startsWith('#') || href.length < 2) return
  const target = document.querySelector<HTMLElement>(href)
  if (!target) return
  e.preventDefault()
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1')
  target.focus({ preventScroll: true })
  history.replaceState(null, '', href)
}
