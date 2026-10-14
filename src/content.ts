// Single source for the hero's copy and links. Facts here are taken from the
// existing portfolio and CV; do not add claims that are not in those.
export const NAME = 'Beri Vishnu'
export const FULL_NAME = 'Beri Vishnu Vardhan Reddy'
export const EMAIL = 'berivishnu9@gmail.com'
export const LINKEDIN = 'https://www.linkedin.com/in/berivishnuvardhanreddy'
export const GITHUB = 'https://github.com/berivishnu9-max'

const base = import.meta.env.BASE_URL
export const CV_URL = `${base}cv.html`

export type Link = { label: string; href: string; external?: boolean }

// Same sections as the sticky header in index.html (#topnav).
export const NAV_LINKS: Link[] = [
  { label: 'Work', href: '#work' },
  { label: 'About', href: '#about' },
  { label: 'Skills', href: '#skills' },
  { label: 'Experience', href: '#record' },
  { label: 'Contact', href: '#contact' },
]

export const EYEBROW = 'Business Analyst · Glasgow, UK'
export const POSITIONING =
  'MSc Business Analysis & Consulting, University of Strathclyde. Four years running a 72-bed operation taught me to turn'
export const POSITIONING_ACCENT = 'messy operations into clear decisions.'
