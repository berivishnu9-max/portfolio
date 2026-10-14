"""Turn the two hand-made 3x3 sheets (head directions, expressions) into the hero
character's atlases.

    python3 tools/build-mascot.py <directions.webp> <reactions.webp> [--debug DIR]

The sheets were drawn on a red background, with grid seams, shoulders cut off at the
cell edges and one damaged cell, so the page-mascot skill's build cannot read them
as they are. This script:

  1. crops each cell along the measured seams,
  2. replaces the damaged down-right cell with the mirrored down-left one,
  3. keys out the red with a local-colour matte (the foreground colour next to each
     edge pixel is estimated from its neighbours and the alpha is solved against it),
     which keeps the red heart and the pink lips intact and removes red spill from hair,
  4. registers every direction onto the front-facing cell by the collar and shoulders,
     so the body stays put while the head turns,
  5. fits the expressions sheet onto the directions sheet by the face (scale and
     position), and builds a blink on the front direction from the closed eyes,
  6. writes public/mascot/{directions,reactions}.webp (3x3, square tiles) and
     public/mascot/manifest.json.
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEST = os.path.join(ROOT, 'public', 'mascot')
TILE = 640

# Measured seams (x0, x1) / (y0, y1), end-exclusive.
GRID = {
    'directions': {'cols': [(0, 337), (342, 681), (685, 1024)], 'rows': [(0, 314), (316, 629), (631, 936)]},
    'reactions': {'cols': [(0, 417), (419, 835), (837, 1254)], 'rows': [(0, 416), (418, 831), (833, 1254)]},
}


# --- colour --------------------------------------------------------------------
def lab(rgb):
    c = rgb.astype(np.float64) / 255.0
    c = np.where(c > 0.04045, ((c + 0.055) / 1.055) ** 2.4, c / 12.92)
    m = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = c @ m.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def local_mean(values, weight, sigma):
    """Weighted Gaussian mean of `values` where `weight` is set (normalised convolution)."""
    w = ndimage.gaussian_filter(weight.astype(np.float64), sigma)
    out = np.stack([ndimage.gaussian_filter(values[..., i] * weight, sigma) for i in range(values.shape[-1])], -1)
    return out / np.maximum(w, 1e-6)[..., None], w


# --- keying --------------------------------------------------------------------
CORE = 13.0   # Lab distance under which a pixel connected to the border is background
BAND = 7      # px either side of the background edge where alpha is solved


def key(cell):
    rgb = np.asarray(cell.convert('RGB')).astype(np.float64)
    h, w, _ = rgb.shape
    border = np.zeros((h, w), bool)
    border[:3, :] = border[-3:, :] = border[:, :3] = border[:, -3:] = True
    redness = rgb[..., 0] - np.maximum(rgb[..., 1], rgb[..., 2])
    seed = border & (redness > 140)
    K0 = np.median(rgb[seed], axis=0)

    L = lab(rgb)
    d = np.linalg.norm(L - lab(K0[None, None])[0, 0], axis=-1)
    near = d < CORE * 1.6
    labels, n = ndimage.label(near)
    keep = set(np.unique(labels[seed])) - {0}
    sizes = ndimage.sum(near, labels, range(1, n + 1))
    keep |= {i + 1 for i, s in enumerate(sizes) if s > 400}
    bg_region = np.isin(labels, list(keep))

    # Background colour varies across the sheet; follow it locally.
    K, _ = local_mean(rgb, bg_region & (d < CORE), 18)
    K = np.where(np.isfinite(K), K, K0)
    d = np.linalg.norm(L - lab(np.clip(K, 0, 255)), axis=-1)
    # Also small pockets of background trapped in the hair fuzz: they are not connected
    # to the border but are unmistakably the key colour.
    # Lab distance alone would also take the felt's deep red-brown shadows by the
    # eyebrows and nostrils, so pockets must be the key's own saturated red.
    pocket = (rgb[..., 1] < 14) & (rgb[..., 0] > 165) & (rgb[..., 0] - rgb[..., 2] > 135) & (d < CORE)
    bg = ndimage.binary_opening(bg_region & (d < CORE), iterations=1) | pocket

    band = ndimage.binary_dilation(bg, iterations=BAND) & ~bg
    fg = ~(bg | band)
    F, fw = local_mean(rgb, fg, 3.5)
    F2, _ = local_mean(rgb, fg, 9)
    F = np.where((fw > 0.02)[..., None], F, F2)

    num = ((rgb - K) * (F - K)).sum(-1)
    den = ((F - K) ** 2).sum(-1)
    a = np.clip(num / np.maximum(den, 1.0), 0, 1)
    alpha = np.where(bg, 0.0, np.where(fg, 1.0, a))
    # Unmix: remove the red the edge pixel picked up from the background.
    safe = np.maximum(alpha, 1e-3)[..., None]
    un = np.clip((rgb - (1 - safe) * K) / safe, 0, 255)
    # Unmixing overshoots where alpha is underestimated and leaves a green rim, so no
    # channel may end up brighter than both what was observed and the foreground.
    un = np.clip(un, np.minimum(F, rgb), np.maximum(F, rgb))
    # Mostly-transparent edge pixels take the colour of the character just inside the
    # edge: unmixing them would amplify noise into olive or teal specks.
    w = smooth((alpha - 0.55) / 0.4)[..., None]
    colour = np.where(band[..., None], F * (1 - w) + un * w, rgb)
    colour = np.where(np.isfinite(colour), colour, rgb)
    # Despill: near the edge, no pixel may be redder than the foreground around it.
    # (Measured against the local foreground, so skin keeps its warmth.)
    near_edge = ndimage.binary_dilation(bg, iterations=BAND + 6) & ~bg
    red_c = colour[..., 0] - np.maximum(colour[..., 1], colour[..., 2])
    red_f = F[..., 0] - np.maximum(F[..., 1], F[..., 2])
    excess = np.clip(red_c - (red_f + 12), 0, None)
    colour[..., 0] = np.where(near_edge, colour[..., 0] - excess, colour[..., 0])
    # Red showing through the hair fuzz, too mixed to count as a pocket: hair is a dark
    # brown with almost no green, and nothing else in the character is that red at
    # that darkness (skin shadows and the mouth all carry far more green).
    gb = np.maximum(colour[..., 1], colour[..., 2])
    tinted = (colour[..., 1] < 22) & (colour[..., 0] > 2.2 * gb + 20)
    colour[..., 0] = np.where(tinted, 1.6 * gb + 15, colour[..., 0])
    # The art also paints red bounce light into the hair curls. Inside dark hair
    # (judged by the neighbourhood, so skin and lips are never touched), no pixel may
    # be much redder than the hair around it.
    hood, _ = local_mean(colour, alpha > 0.5, 6)
    hood_lum = hood @ np.array([0.299, 0.587, 0.114])
    hood_red = hood[..., 0] - np.maximum(hood[..., 1], hood[..., 2])
    gb = np.maximum(colour[..., 1], colour[..., 2])
    cap = gb + np.maximum(hood_red, 0) + 20
    in_hair = (hood_lum < 95) & (alpha > 0)
    # Lighter, highlighted hair fails the darkness test, so also catch red-dominant
    # pixels above the eye line that are far redder than their surroundings. The heart
    # is its own surroundings, so it is left alone; lips and blush are below the line.
    colour[..., 0] = np.where(in_hair & (colour[..., 0] > cap), cap, colour[..., 0])
    # Highlighted curls fail the darkness test and are red over a whole patch, so a
    # local comparison misses them too. They are told apart by hue: the bounce light is
    # pink-red (blue close to green), while skin, even in shadow, is orange (blue well
    # below green). Only above the eye line, where the hair is and the blush and lips
    # are not, and only on the character itself, which leaves a floating heart alone.
    labels, n = ndimage.label(alpha > 0.5)
    body = labels == (np.argmax(ndimage.sum(alpha > 0.5, labels, range(1, n + 1))) + 1) if n else alpha > 0.5
    body = ndimage.binary_dilation(body, iterations=2)
    top = np.arange(h)[:, None] < 0.4 * h
    r_, g_, b_ = colour[..., 0], colour[..., 1], colour[..., 2]
    pink = top & body & (g_ < 0.45 * r_) & (b_ > 0.65 * g_)
    colour[..., 0] = np.where(pink, np.minimum(r_, np.maximum(g_, b_) * 1.35 + 10), r_)
    out = np.dstack([colour, alpha * 255]).round().clip(0, 255).astype(np.uint8)
    return Image.fromarray(out, 'RGBA')


def cells(path, kind):
    sheet = Image.open(path).convert('RGB')
    g = GRID[kind]
    return [sheet.crop((x0, y0, x1, y1)) for (y0, y1) in g['rows'] for (x0, x1) in g['cols']]


# --- alignment -----------------------------------------------------------------
def shirt_mask(t):
    a = np.asarray(t).astype(np.float64)
    return (a[..., 3] > 128) & (a[..., :3].min(-1) > 165)


def register(moving, ref, search=24, margin=26):
    """Translation that best lays `moving`'s shirt (collar and shoulders) on `ref`'s.

    Only an inner window is compared: the shirt is cut off at every cell's sides and
    bottom, and those cut lines sit at the same place in every cell whatever the body
    does, so letting them vote would pull every answer towards zero.
    """
    m, r = shirt_mask(moving), shirt_mask(ref)
    h, w = r.shape
    best = (-1.0, 0, 0)
    for dy in range(-search, search + 1):
        for dx in range(-search, search + 1):
            y0, y1 = max(0, dy) + 0, min(h, m.shape[0] + dy)
            x0, x1 = max(margin, dx), min(w - margin, m.shape[1] + dx) 
            y1 = min(y1, h - margin)
            if y1 - y0 < 40 or x1 - x0 < 40:
                continue
            rr = r[y0:y1, x0:x1]
            mm = m[y0 - dy:y1 - dy, x0 - dx:x1 - dx]
            inter = (rr & mm).sum()
            union = (rr | mm).sum()
            score = inter / max(union, 1)
            if score > best[0]:
                best = (score, dx, dy)
    return best


S_SRC = 344                    # square tile side, in directions-sheet pixels


def place(t, scale, ox, oy):
    """Paste tile t, scaled, at (ox, oy) on a square canvas; also return its footprint."""
    if scale != 1:
        t = t.resize((round(t.width * scale), round(t.height * scale)), Image.LANCZOS)
    canvas = Image.new('RGBA', (S_SRC, S_SRC), (0, 0, 0, 0))
    canvas.alpha_composite(t, (round(ox), round(oy))) if ox >= 0 and oy >= 0 else canvas.paste(t, (round(ox), round(oy)), t)
    foot = np.zeros((S_SRC, S_SRC), np.float64)
    x0, y0 = max(0, round(ox)), max(0, round(oy))
    foot[y0:min(S_SRC, round(oy) + t.height), x0:min(S_SRC, round(ox) + t.width)] = 1
    return canvas, foot


def smooth(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def bust(frame, foot, collar_y):
    """Dissolve the shoulders and every cut edge, keep the head and the collar."""
    a = np.asarray(frame).astype(np.float64)
    ys, xs = np.mgrid[0:S_SRC, 0:S_SRC].astype(np.float64)
    cx = S_SRC / 2
    below = smooth((ys - collar_y) / 40)                       # 0 above the collar
    side = smooth((np.abs(xs - cx) - 0.30 * S_SRC) / (0.15 * S_SRC))
    bottom = smooth((ys - 0.80 * S_SRC) / (0.19 * S_SRC))
    # distance to the footprint's edge, for the cut lines of a scaled-down cell
    dist = ndimage.distance_transform_edt(np.pad(foot, 1))[1:-1, 1:-1]
    cut = smooth(dist / 18)
    keep = (1 - below * side) * (1 - bottom) * cut
    a[..., 3] *= keep
    return Image.fromarray(a.round().clip(0, 255).astype(np.uint8), 'RGBA')



FACE_BOX = (125, 268, 66, 278)   # y0, y1, x0, x1 in tile pixels: brows down to the chin


def dark(frame):
    a = np.asarray(frame).astype(np.float64)
    lum = a[..., :3] @ np.array([0.299, 0.587, 0.114])
    return (a[..., 3] > 200) & (lum < 80)


def face_fit(front, rcell):
    """Scale and position for the expressions sheet that best lays its front face on `front`."""
    y0, y1, x0, x1 = FACE_BOX
    ref = dark(front)[y0:y1, x0:x1]
    best = (-1.0, 0.0, 0, 0)
    for s in np.arange(0.66, 0.84, 0.01):
        t = rcell.resize((round(rcell.width * s), round(rcell.height * s)), Image.LANCZOS)
        m = dark(t)
        # coarse 2px search, then refine around the best
        def score(ox, oy):
            sy0, sx0 = y0 - oy, x0 - ox
            if sy0 < 0 or sx0 < 0 or sy0 + (y1 - y0) > m.shape[0] or sx0 + (x1 - x0) > m.shape[1]:
                return -1.0
            mm = m[sy0:sy0 + (y1 - y0), sx0:sx0 + (x1 - x0)]
            return (ref & mm).sum() / max((ref | mm).sum(), 1)
        cand = max((score(ox, oy), ox, oy) for ox in range(-60, 40, 2) for oy in range(-60, 40, 2))
        cand = max((score(ox, oy), ox, oy) for ox in range(cand[1] - 2, cand[1] + 3) for oy in range(cand[2] - 2, cand[2] + 3))
        if cand[0] > best[0]:
            best = (cand[0], float(s), cand[1], cand[2])
    return best[1], best[2], best[3], best[0]


def irises(frame):
    """Centres of the two irises: the largest dark blobs in the band between brows and nose."""
    a = np.asarray(frame).astype(np.float64)
    lum = a[..., :3] @ np.array([0.299, 0.587, 0.114])
    d = (a[..., 3] > 200) & (lum < 70)
    d[:140] = d[175:] = False
    labels, n = ndimage.label(d)
    sizes = ndimage.sum(d, labels, range(1, n + 1))
    centres = ndimage.center_of_mass(d, labels, range(1, n + 1))
    mid = S_SRC / 2
    # one per side of the face, inside the cheeks (the hair at the temples is dark too)
    pick = []
    for lo, hi in ((mid - 62, mid - 6), (mid + 6, mid + 62)):
        side = [(sz, c) for sz, c in zip(sizes, centres) if lo < c[1] < hi and 30 < sz < 600]
        pick.append(max(side)[1])
    return pick


def shift_to_face(frame, ref, search=14):
    """Translate `frame` so its brows, eyes and beard sit on `ref`'s."""
    y0, y1, x0, x1 = FACE_BOX
    r = dark(ref)[y0:y1, x0:x1]
    m = dark(frame)
    best = max(((r & m[y0 - dy:y1 - dy, x0 - dx:x1 - dx]).sum() / max((r | m[y0 - dy:y1 - dy, x0 - dx:x1 - dx]).sum(), 1), dx, dy)
               for dx in range(-search, search + 1) for dy in range(-search, search + 1))
    out = Image.new('RGBA', frame.size, (0, 0, 0, 0))
    out.alpha_composite(frame, (0, 0)) if best[1:] == (0, 0) else out.paste(frame, best[1:], frame)
    return out


def blink_from(front, closed):
    """Front direction with the closed eyes of `closed` (already face-fitted) set into it."""
    closed = shift_to_face(closed, front)
    f = np.asarray(front).astype(np.float64)
    c = np.asarray(closed).astype(np.float64)
    ys, xs = np.mgrid[0:S_SRC, 0:S_SRC].astype(np.float64)
    (ly, lx), (ry_, rx_) = irises(front)
    span = rx_ - lx
    out = f.copy()
    for ey, ex in ((ly, lx), (ry_, rx_)):
        # an eye is about half the iris spacing wide and a third of it tall
        r = np.hypot((xs - ex) / (span * 0.34), (ys - ey) / (span * 0.18))
        # fully replaced across the whole open eye, feathered only outside it
        patch = smooth((1.3 - r) / 0.45)
        # match the skin just outside the patch, so it has no visible edge
        ring = (r > 1.2) & (r < 1.7) & (f[..., 3] > 200) & (c[..., 3] > 200)
        lum = lambda x: x[..., :3] @ np.array([0.299, 0.587, 0.114])
        ring &= (lum(f) > 90) & (lum(c) > 90)                            # skin, not brow or lash
        moved = np.clip(c[..., :3] + (f[ring, :3].mean(0) - c[ring, :3].mean(0)), 0, 255)
        out[..., :3] = out[..., :3] * (1 - patch[..., None]) + moved * patch[..., None]
    return Image.fromarray(out.round().clip(0, 255).astype(np.uint8), 'RGBA')


if __name__ == '__main__':
    dpath, rpath = sys.argv[1], sys.argv[2]
    debug = sys.argv[sys.argv.index('--debug') + 1] if '--debug' in sys.argv else None
    dcells = cells(dpath, 'directions')
    # Down-right is damaged (a smoke-like smear over the mouth); its mirror twin is clean.
    dcells[8] = dcells[6].transpose(Image.FLIP_LEFT_RIGHT)
    rcells = cells(rpath, 'reactions')
    dk = [key(c) for c in dcells]
    rk = [key(c) for c in rcells]

    # Directions: front cell sits bottom-centre; the rest are registered onto it.
    front = dk[4]
    fx, fy = (S_SRC - front.width) / 2, S_SRC - front.height
    frames, feet, report = [], [], []
    for i, t in enumerate(dk):
        score, dx, dy = (1.0, 0, 0) if i == 4 else register(t, front)
        f, ft = place(t, 1, fx + dx, fy + dy)
        frames.append(f); feet.append(ft); report.append(('d', i, dx, dy, round(score, 3)))

    # Expressions: drawn chubbier and at another scale, so fit the front-facing one onto
    # the front direction by the face itself (brows, eyes, beard, mouth) - the hair is
    # styled differently between the sheets and would drag the fit. The other
    # expressions are then registered onto that one by their shoulders.
    s_fit, rx, ry, fscore = face_fit(frames[4], rk[4])
    print(f'  face fit  scale {s_fit:.3f}  at {rx:+.0f},{ry:+.0f}  overlap {fscore:.3f}')
    for i, t in enumerate(rk):
        if i == 4:
            score, dx, dy = 1.0, 0, 0
        else:
            score, dx, dy = register(t, rk[4], search=30)
        f, ft = place(t, s_fit, rx + dx * s_fit, ry + dy * s_fit)
        frames.append(f); feet.append(ft); report.append(('r', i, dx, dy, round(score, 3)))
    # The expressions sheet's own blink is that sheet's chubbier face, which would make
    # every blink a twitch. Build one on the front direction instead.
    frames[9] = blink_from(frames[4], frames[9])
    feet[9] = feet[4]
    for r in report:
        print('  %s%d  shift %+d,%+d  shirt overlap %.3f' % r)

    collar = fy + 241
    out = [bust(f, ft, collar) for f, ft in zip(frames, feet)]
    os.makedirs(DEST, exist_ok=True)
    for kind, group in (('directions', out[:9]), ('reactions', out[9:])):
        atlas = Image.new('RGBA', (TILE * 3, TILE * 3), (0, 0, 0, 0))
        for i, f in enumerate(group):
            big = f.resize((TILE, TILE), Image.LANCZOS).filter(ImageFilter.UnsharpMask(radius=1.2, percent=40, threshold=2))
            atlas.paste(big, ((i % 3) * TILE, (i // 3) * TILE))
        path = os.path.join(DEST, f'{kind}.webp')
        atlas.save(path, quality=86, method=6)
        print(f'  {path}  {os.path.getsize(path) // 1024} KB')
    with open(os.path.join(DEST, 'manifest.json'), 'w') as fh:
        json.dump({'tile': TILE, 'face': [0.5, round((fy + 124) / S_SRC, 3)],
                   'directions': ['up-left', 'up', 'up-right', 'left', 'front', 'right', 'down-left', 'down', 'down-right'],
                   'reactions': ['blink', 'heart', 'sparkle', 'surprised', 'bright', 'bashful', 'sleepy', 'dizzy', 'delighted']}, fh, indent=1)
    if debug:
        os.makedirs(debug, exist_ok=True)
        for i, f in enumerate(out):
            f.save(os.path.join(debug, f'f{i:02d}.png'))
