# Beri Vishnu Vardhan Reddy — Business Analyst Portfolio

Live site: https://berivishnu9-max.github.io/portfolio

Portfolio of business analysis and consulting case work, covering enterprise risk
governance, process redesign, public-sector prioritisation, sustainability analysis,
decision modelling and demand forecasting.

One continuous page: a full-screen crimson hero whose character follows the cursor with its eyes and blinks, then the
case studies, skills, experience, certificates and contact sections below it.

- `index.html` — the page: hand-written sections and styles, with the hero mounted at `#root`
- `src/` — the hero (React, TypeScript, Vite, Tailwind CSS); copy and links live in `src/content.ts`
- `public/cv.html` — CV, printable to PDF
- `public/work.html` — redirect so old `work.html` links still land on the right section
- `public/character/` — layered hero character (eyes, irises, lids) built from one front-facing frame by `tools/build-character.py`; animated by `src/components/Character.tsx`
- `public/certs/`, `public/me.jpg` — certificates and profile photo

Palette: canvas `#FAF9F6`, charcoal `#2C302E`, gold `#D4AF37` for fills, deep gold `#8A6D1A` for gold text.

## Develop

```bash
npm install
npm run dev      # local dev server
npm run build    # production build into dist/
```

Pushes to `main` build and deploy via `.github/workflows/deploy.yml`. In the repo's
Settings → Pages, the source must be set to **GitHub Actions**.

Contact: berivishnu9@gmail.com · https://www.linkedin.com/in/berivishnuvardhanreddy
