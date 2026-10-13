// Single source for the copy and links on the landing page.
export const NAME = 'Beri Vishnu'
export const EMAIL = 'berivishnu9@gmail.com'
export const LINKEDIN = 'https://www.linkedin.com/in/berivishnuvardhanreddy'

const base = import.meta.env.BASE_URL

export const NAV_LINKS = [
  { label: 'Work', href: `${base}work.html#work` },
  { label: 'CV', href: `${base}cv.html` },
  { label: 'Certificates', href: `${base}work.html#certificates` },
  { label: 'LinkedIn', href: LINKEDIN, external: true },
]

export const INTRO = [
  'Hey there, meet Beri Vishnu Vardhan Reddy,',
  'MSc Business Analysis & Consulting, University of Strathclyde',
]

export const TYPED =
  'Four years running a 72-bed property taught me to turn messy operations into clear decisions. Now, what are we solving?'

export const ACTIONS = [
  { label: 'See my case studies', href: `${base}work.html#work` },
  { label: 'Read my CV', href: `${base}cv.html` },
  { label: 'View certificates', href: `${base}work.html#certificates` },
  { label: 'Connect on LinkedIn', href: LINKEDIN, external: true },
]
