/** @type {import('tailwindcss').Config} */
export default {
  // Only the React hero uses Tailwind; the rest of index.html is hand-written CSS,
  // so don't scan it and don't let Preflight reset its styles.
  content: ['./src/**/*.{ts,tsx}'],
  corePlugins: { preflight: false },
  theme: {
    extend: {
      colors: {
        canvas: '#FAF9F6',
        charcoal: '#2C302E',
        gold: '#D4AF37', // fills, and text on charcoal only
        accent: '#7A5F12', // gold for text on canvas
      },
      // Landscape tablet and up: the character sits right, the copy left.
      screens: { wide: { raw: '(min-width: 768px) and (min-aspect-ratio: 1/1)' } },
    },
  },
  plugins: [],
}
