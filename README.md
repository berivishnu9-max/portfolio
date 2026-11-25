# Beri Vishnu Vardhan Reddy — Business Analyst Portfolio

Live site: https://berivishnu9-max.github.io/portfolio

Portfolio of business analysis and consulting case work, covering enterprise risk
governance, process redesign, public-sector prioritisation, sustainability analysis,
decision modelling and demand forecasting.

One continuous page: a full-screen charcoal hero whose character turns its head toward the cursor and reacts when
clicked, then the case studies, about, skills, experience, certificates and contact sections below it.

- `index.html` — the page: hand-written sections and styles, with the hero mounted at `#root`
- `src/` — the hero (React, TypeScript, Vite, Tailwind CSS); copy and links live in `src/content.ts`
- `public/cv.html` — CV, printable to PDF
- `public/work.html` — redirect so old `work.html` links still land on the right section
- `public/mascot/` — the hero character: two 3×3 atlases (nine head directions, nine expressions) built from
  the hand-made sheets in `tools/mascot-src/` by `tools/build-mascot.py` (keys out the red background, mirrors
  the damaged right-facing cells from their left-facing twins, keeps the shoulders still across every pose and
  expression, builds the blink); played by `src/components/Character.tsx`, which turns the head toward the
  cursor, keeps the head moving on springs (it leans and tilts toward the pointer, sways when idle, bounces
  when clicked; the shoulders never move) and plays an expression when the head is clicked or tapped. Rebuild with
  `python3 tools/build-mascot.py` (needs Pillow, NumPy and SciPy).
- `public/certs/`, `public/me.jpg` — certificates and profile photo

Palette: canvas `#FAF9F6` (60%), charcoal `#2C302E` (30%), gold `#D4AF37` (10%) for fills and for text on charcoal
only; deep gold `#7A5F12` for gold text on canvas. `tailwind.config.js` mirrors the `:root` tokens in `index.html`.

## Develop

```bash
npm install
npm run dev      # local dev server
npm run build    # production build into dist/
```

Pushes to `main` build and deploy via `.github/workflows/deploy.yml`. In the repo's
Settings → Pages, the source must be set to **GitHub Actions**.

Contact: berivishnu9@gmail.com · https://www.linkedin.com/in/berivishnuvardhanreddy

## Live avatar (video-derived clips)

`public/mascot/` is the always-available sprite character. For smooth head turns, generate nine short
Veo clips from the character's own start and end frames, then run:

```bash
python3 tools/build-clips.py <folder-with-the-nine-mp4s>   # needs ffmpeg, Pillow, NumPy
```

This keys the green screen, pins the shoulders still, and writes frame atlases and a manifest to
`public/clips/`. When that manifest exists the hero plays the clips (a real path of frames for every head
direction, a looping idle with blinks); otherwise it uses the sprites. Clip names: `01-left`, `02-right`,
`03-up`, `04-down`, `05-up-left`, `06-up-right`, `07-down-left`, `08-down-right`, `09-idle`.
