import { useEffect, useRef, useState } from 'react'
import { CV_URL, EMAIL, LINKEDIN, NAME, NAV_LINKS } from '../content'
import { scrollToHash } from '../lib/scroll'

const menuLink = 'inline-flex min-h-[44px] items-center text-charcoal underline underline-offset-4'

export default function Navbar() {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    menuRef.current?.querySelector<HTMLElement>('a')?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        toggleRef.current?.focus()
      } else if (e.key === 'Tab') {
        // The menu covers the page: keep focus cycling between its links and the close button.
        const items = [toggleRef.current, ...Array.from(menuRef.current?.querySelectorAll<HTMLElement>('a') ?? [])].filter(
          Boolean,
        ) as HTMLElement[]
        const i = items.indexOf(document.activeElement as HTMLElement)
        e.preventDefault()
        items[(i + (e.shiftKey ? -1 : 1) + items.length) % items.length].focus()
      }
    }
    window.addEventListener('keydown', onKey)

    // The menu covers the page, so the page must not scroll behind it or stay in the
    // accessibility tree: lock scrolling and make everything but the menu and its
    // toggle inert, walking up from the menu to <body>.
    const root = document.documentElement
    const overflow = root.style.overflow
    root.style.overflow = 'hidden'
    const menu = menuRef.current
    const toggle = toggleRef.current
    const madeInert: HTMLElement[] = []
    for (let el: HTMLElement | null = menu; el && el !== document.body; el = el.parentElement) {
      for (const sib of Array.from(el.parentElement?.children ?? [])) {
        if (!(sib instanceof HTMLElement) || sib === el || sib.inert) continue
        if ((menu && sib.contains(menu)) || (toggle && sib.contains(toggle)) || sib.tagName === 'SCRIPT') continue
        sib.inert = true
        madeInert.push(sib)
      }
    }
    return () => {
      window.removeEventListener('keydown', onKey)
      root.style.overflow = overflow
      madeInert.forEach((el) => (el.inert = false))
    }
  }, [open])

  // Widening past the phone layout hides the menu and its toggle: close it, or the
  // focus handling above would keep trapping Tab on elements that are not shown.
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const onChange = () => mq.matches && setOpen(false)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const go = (e: React.MouseEvent<HTMLAnchorElement>) => {
    setOpen(false)
    scrollToHash(e)
  }

  return (
    <>
      <nav
        aria-label="Primary"
        className="absolute left-0 top-0 z-10 flex h-16 w-full items-center justify-between px-[var(--gutter)] py-0 sm:h-20"
      >
        <a href="#top" onClick={go} className={`flex items-center gap-3 text-canvas no-underline ${open ? 'invisible' : ''}`}>
          <span className="text-[20px] font-semibold tracking-tight sm:text-[23px]">{NAME}</span>
          <span aria-hidden="true" className="select-none text-[22px] sm:text-[26px]" style={{ letterSpacing: '-0.02em' }}>
            ✳︎
          </span>
        </a>

        <ul className="m-0 hidden list-none p-0 text-[17px] text-canvas md:flex">
          {NAV_LINKS.map((link, i) => (
            <li key={link.label}>
              <a href={link.href} onClick={go} className="nav-link text-canvas no-underline">
                {link.label}
              </a>
              {i < NAV_LINKS.length - 1 && <span className="whitespace-pre" aria-hidden="true">, </span>}
            </li>
          ))}
        </ul>

        <a
          href={CV_URL}
          target="_blank"
          rel="noopener"
          className="hidden min-h-[40px] items-center rounded-full border border-solid border-canvas/70 px-5 text-[15px] font-medium text-canvas no-underline transition-colors duration-200 hover:bg-canvas hover:text-charcoal md:inline-flex"
        >
          CV<span className="sr-only"> (opens in a new tab)</span>&nbsp;<span aria-hidden="true">↗</span>
        </a>

        <button
          ref={toggleRef}
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          aria-controls="mobile-menu"
          className="relative z-10 flex h-11 w-11 cursor-pointer flex-col items-center justify-center gap-[5px] border-0 bg-transparent md:hidden"
        >
          <span
            className={`h-[2px] w-6 transition-all duration-300 ${
              open ? 'translate-y-[7px] rotate-45 bg-charcoal' : 'bg-canvas'
            }`}
          />
          <span className={`h-[2px] w-6 bg-canvas transition-opacity duration-300 ${open ? 'opacity-0' : 'opacity-100'}`} />
          <span
            className={`h-[2px] w-6 transition-all duration-300 ${
              open ? '-translate-y-[7px] -rotate-45 bg-charcoal' : 'bg-canvas'
            }`}
          />
        </button>
      </nav>

      <div
        id="mobile-menu"
        ref={menuRef}
        aria-hidden={!open}
        // inert keeps hidden links out of the tab order and away from screen readers
        {...(!open ? { inert: '' } : {})}
        className="fixed inset-0 z-[9] flex flex-col justify-[safe_center] gap-6 overflow-y-auto bg-canvas px-8 pb-6 pt-[72px] transition-opacity duration-300 md:hidden"
        style={{ opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none' }}
      >
        <ul className="m-0 flex list-none flex-col gap-5 p-0">
          {NAV_LINKS.map((link) => (
            <li key={link.label}>
              <a href={link.href} onClick={go} className="inline-flex min-h-[44px] items-center text-[34px] font-semibold tracking-tight text-charcoal no-underline">
                {link.label}
              </a>
            </li>
          ))}
        </ul>
        <div className="mt-6 flex flex-wrap gap-x-6 gap-y-3 border-0 border-t border-solid border-charcoal/15 pt-6 text-[17px]">
          <a href={CV_URL} target="_blank" rel="noopener" className={menuLink}>
            CV<span className="sr-only"> (opens in a new tab)</span>
          </a>
          <a href={`mailto:${EMAIL}`} className={menuLink}>
            Email
          </a>
          <a href={LINKEDIN} target="_blank" rel="noopener noreferrer" className={menuLink}>
            LinkedIn<span className="sr-only"> (opens in a new tab)</span>
          </a>
        </div>
      </div>
    </>
  )
}
