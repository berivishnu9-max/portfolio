import { useEffect, useState } from 'react'
import { useTypewriter } from '../hooks/useTypewriter'
import { ACTIONS, EMAIL, INTRO, TYPED } from '../content'

const pill =
  'inline-flex items-center justify-center rounded-full text-[13px] sm:text-[15px] px-4 sm:px-5 py-[0.3em] mx-[0.2em] mb-[0.4em] whitespace-nowrap transition-colors duration-200'

function CopyIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <rect x="3.5" y="3.5" width="7" height="7" rx="1" stroke="currentColor" />
      <path d="M8.5 1.5h-6a1 1 0 0 0-1 1v6" stroke="currentColor" />
    </svg>
  )
}

export default function Hero() {
  const { displayed, done } = useTypewriter(TYPED)
  const [showActions, setShowActions] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const t = window.setTimeout(() => setShowActions(true), 400)
    return () => window.clearTimeout(t)
  }, [])

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(EMAIL)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      window.location.href = `mailto:${EMAIL}`
    }
  }

  return (
    <div className="relative z-[1] flex h-screen flex-col justify-end overflow-hidden px-5 pb-12 sm:px-8 md:px-10 wide:justify-center wide:pb-0">
      <div className="relative z-10 max-w-xl">
        {/* Readable copy for screen readers and search engines; the blurred line is decorative. */}
        <h1 className="sr-only">
          Beri Vishnu Vardhan Reddy — Business Analyst. {INTRO[1]}. {TYPED}
        </h1>

        <div
          aria-hidden="true"
          className="pointer-events-none mb-5 select-none sm:mb-6"
          style={{
            fontSize: 'clamp(18px, 4vw, 26px)',
            lineHeight: 1.3,
            fontWeight: 400,
            color: '#2C302E',
            filter: 'blur(4px)',
          }}
        >
          {INTRO[0]}
          <br />
          {INTRO[1]}
        </div>

        <p
          aria-hidden="true"
          className="mb-5 mt-0 text-charcoal sm:mb-6"
          style={{
            fontSize: 'clamp(18px, 4vw, 26px)',
            lineHeight: 1.35,
            fontWeight: 400,
            minHeight: 54,
          }}
        >
          {displayed}
          {!done && (
            <span className="animate-blink ml-[2px] inline-block h-[1.1em] w-[2px] bg-charcoal align-middle" />
          )}
        </p>

        <div
          className="flex flex-wrap gap-y-1"
          style={{
            opacity: showActions ? 1 : 0,
            transform: showActions ? 'translateY(0)' : 'translateY(8px)',
            transition: 'opacity 0.4s ease, transform 0.4s ease',
          }}
        >
          {ACTIONS.map((action) => (
            <a
              key={action.label}
              href={action.href}
              {...(action.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              className={`${pill} border border-solid border-charcoal/15 bg-white text-charcoal no-underline hover:bg-charcoal hover:text-canvas`}
            >
              {action.label}
            </a>
          ))}
          <button
            type="button"
            onClick={copyEmail}
            className={`${pill} cursor-pointer gap-2 border border-solid border-gold bg-gold font-[inherit] text-charcoal hover:border-charcoal hover:bg-charcoal hover:text-canvas sm:gap-3`}
          >
            <span>
              {copied ? (
                'Copied to clipboard'
              ) : (
                <>
                  Reach me: <span className="underline underline-offset-1">{EMAIL}</span>
                </>
              )}
            </span>
            <CopyIcon />
          </button>
          <span className="sr-only" aria-live="polite">
            {copied ? 'Email address copied' : ''}
          </span>
        </div>
      </div>
    </div>
  )
}
