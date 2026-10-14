import { CREDENTIAL, CV_URL, EYEBROW, FULL_NAME, POSITIONING, POSITIONING_ACCENT } from '../content'
import { scrollToHash } from '../lib/scroll'

const btn =
  'hero-btn inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full px-6 text-[15px] font-medium no-underline transition-colors duration-200 sm:text-[16px]'

export default function Hero() {
  return (
    <div className="hero-content pointer-events-none z-[1] px-[var(--gutter)]">
      <div className="hero-copy pointer-events-auto relative z-10 max-w-[34rem] wide:max-w-[min(30rem,36vw)]">
        <p className="hero-rise hero-eyebrow m-0 mb-4 text-[14px] font-medium uppercase tracking-[0.12em] text-gold sm:text-[16px]">
          {EYEBROW}
        </p>
        <h1
          className="hero-rise hero-h1 m-0 font-semibold leading-[0.98] tracking-[-0.03em] text-canvas"
          style={{ animationDelay: '60ms' }}
        >
          {FULL_NAME}
        </h1>
        <p className="hero-rise hero-lede mb-0 mt-5 text-canvas sm:mt-6" style={{ lineHeight: 1.5, animationDelay: '120ms' }}>
          {POSITIONING}{' '}
          <em className="font-normal text-gold" style={{ fontFamily: 'var(--font-serif)', fontSize: '1.12em', lineHeight: 1 }}>
            {POSITIONING_ACCENT}
          </em>
        </p>
        <div className="hero-rise hero-ctas mt-7 flex flex-wrap items-center gap-3 sm:mt-8" style={{ animationDelay: '180ms' }}>
          <a href="#work" onClick={scrollToHash} className={`${btn} bg-gold text-charcoal hover:bg-canvas`}>
            View case studies
            <span aria-hidden="true">→</span>
          </a>
          <a
            href="#contact"
            onClick={scrollToHash}
            className={`${btn} border border-solid border-canvas/70 text-canvas hover:border-canvas hover:bg-canvas hover:text-charcoal`}
          >
            Contact me
          </a>
          <a
            href={CV_URL}
            target="_blank"
            rel="noopener"
            className="hero-link inline-flex min-h-[44px] items-center px-0 text-[15px] font-medium text-canvas underline decoration-canvas/50 underline-offset-4 transition-colors hover:decoration-canvas sm:text-[16px]"
          >
            View CV<span className="sr-only"> (opens in a new tab)</span>
            <span aria-hidden="true">&nbsp;↗</span>
          </a>
        </div>
        {/* The strongest verifiable credential, where a recruiter's first look lands. */}
        <p
          className="hero-rise hero-cred m-0 mt-6 flex items-start gap-2 text-[14px] leading-[1.5] text-canvas/80 sm:text-[15px]"
          style={{ animationDelay: '240ms' }}
        >
          <span aria-hidden="true" className="mt-[8px] h-[6px] w-[6px] flex-none rounded-full bg-gold" />
          <a
            href="#certificates"
            onClick={scrollToHash}
            className="text-inherit underline decoration-canvas/40 underline-offset-4 transition-colors hover:decoration-canvas"
          >
            {CREDENTIAL}
          </a>
        </p>
      </div>
    </div>
  )
}
