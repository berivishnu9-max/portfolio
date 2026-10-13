/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Landscape tablet and up: the video leaves the left side clear for centred copy.
      screens: { wide: { raw: '(min-width: 768px) and (min-aspect-ratio: 1/1)' } },
    },
  },
  plugins: [],
}
