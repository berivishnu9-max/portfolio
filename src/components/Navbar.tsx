import { useEffect, useState } from 'react'
import { EMAIL, NAME, NAV_LINKS } from '../content'

const linkProps = (external?: boolean) =>
  external ? { target: '_blank', rel: 'noopener noreferrer' } : {}

export default function Navbar() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <nav className="absolute top-0 left-0 z-10 flex w-full items-center justify-between px-5 py-4 sm:px-8 sm:py-5">
        <a href={import.meta.env.BASE_URL} className="flex items-center gap-3 text-canvas no-underline">
          <span
            className="text-[21px] tracking-tight sm:text-[26px]"
            style={{ fontFamily: 'var(--font-heading)' }}
          >
            {NAME}
          </span>
          <span
            aria-hidden="true"
            className="select-none text-[25px] sm:text-[30px]"
            style={{ letterSpacing: '-0.02em' }}
          >
            ✳︎
          </span>
        </a>

        <div className="hidden text-[23px] text-canvas md:flex">
          {NAV_LINKS.map((link, i) => (
            <span key={link.label}>
              <a
                href={link.href}
                {...linkProps(link.external)}
                className="transition-opacity hover:opacity-60"
              >
                {link.label}
              </a>
              {i < NAV_LINKS.length - 1 && <span className="whitespace-pre">, </span>}
            </span>
          ))}
        </div>

        <a
          href={`mailto:${EMAIL}`}
          className="hidden text-[23px] text-canvas underline underline-offset-2 transition-opacity hover:opacity-60 md:inline"
        >
          Get in touch
        </a>

        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          aria-controls="mobile-menu"
          className="relative z-10 flex cursor-pointer flex-col gap-[5px] border-0 bg-transparent p-2 md:hidden"
        >
          <span
            className={`h-[2px] w-6 transition-all duration-300 ${
              open ? 'translate-y-[7px] rotate-45 bg-charcoal' : 'bg-canvas'
            }`}
          />
          <span
            className={`h-[2px] w-6 bg-canvas transition-opacity duration-300 ${
              open ? 'opacity-0' : 'opacity-100'
            }`}
          />
          <span
            className={`h-[2px] w-6 transition-all duration-300 ${
              open ? '-translate-y-[7px] -rotate-45 bg-charcoal' : 'bg-canvas'
            }`}
          />
        </button>
      </nav>

      <div
        id="mobile-menu"
        aria-hidden={!open}
        className="fixed inset-0 z-[9] flex flex-col justify-center gap-8 bg-canvas/95 px-8 backdrop-blur-sm transition-opacity duration-300 md:hidden"
        style={{ opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none' }}
      >
        {NAV_LINKS.map((link) => (
          <a
            key={link.label}
            href={link.href}
            {...linkProps(link.external)}
            tabIndex={open ? 0 : -1}
            onClick={() => setOpen(false)}
            className="text-[32px] font-medium text-charcoal"
          >
            {link.label}
          </a>
        ))}
        <a
          href={`mailto:${EMAIL}`}
          tabIndex={open ? 0 : -1}
          className="text-[32px] font-medium text-charcoal underline underline-offset-2"
        >
          Get in touch
        </a>
      </div>
    </>
  )
}
