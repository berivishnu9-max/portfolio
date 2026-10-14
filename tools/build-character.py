"""Build the layered hero character from one front-facing frame of the Kling clip.

This is 2D layering of the real character art, not a 3D rig. It splits the
eyes into parts that can move independently:

  base.webp        the frame with the irises painted out (eye whites rebuilt)
  poster.webp      the untouched frame, shown until the live character is ready
  iris-N.png       each iris as a complete disc, specular highlights removed
                   (the runtime draws them, so they stay put as the iris moves)
  open-N.png       mask of each eye opening; irises are clipped to it
  shade-N.png      the upper lid's shadow on the eyeball, drawn over the iris
  lid-N.png        sprite of LID_STEPS upper-lid positions from open to closed,
                   made by stretching the real lid skin and lash line down
  character.json   geometry for the runtime

Usage: python3 tools/build-character.py FRAME.png OUT_DIR

FRAME is frame 72 of the "animate it" clip (front-facing, eyes open). The
base is cropped at CROP_H, just above the generator's corner watermark.
"""
import json, sys
import numpy as np
from PIL import Image, ImageFilter

src, out = sys.argv[1], sys.argv[2]
img = np.asarray(Image.open(src).convert('RGB')).astype(np.float32)
H, W, _ = img.shape
LID_STEPS = 10
CROP_H = 1290

# Measured on the frame (grid overlays): eye corners, upper-lid apex, lower-lid
# low point, iris centre/radius and the two specular highlights per iris.
EYES = [
    dict(A=(538, 513), B=(688, 514), up=(622, 463), lo=(628, 523),
         iris=(626.5, 494.0), r=38.0, hl=[(613.3, 486.0, 3.6), (641.7, 487.7, 3.6)]),
    dict(A=(808, 519), B=(966, 528), up=(878, 466), lo=(886, 536),
         iris=(869.0, 502.0), r=38.0, hl=[(855.0, 494.0, 3.6), (883.3, 494.0, 3.6)]),
]
LASH = 13  # dark lash line + socket outline that slides down with the lid edge
PAD = 32  # lid skin above the upper lid that slides down when blinking (stays below the brow)


def lum(a):
    return a[..., 0] * .299 + a[..., 1] * .587 + a[..., 2] * .114


def upper_y(e, x):
    """Upper lid: an elliptical arc over the corner line, asymmetric about the apex."""
    (ax, ay), (bx, by), (px, py) = e['A'], e['B'], e['up']
    base = ay + (by - ay) * (x - ax) / (bx - ax)
    h = (ay + (by - ay) * (px - ax) / (bx - ax)) - py
    half = np.where(x < px, px - ax, bx - px)
    u = np.clip((x - px) / half, -1, 1)
    return base - h * np.sqrt(1 - u * u) ** 0.8


def lower_y(e, x):
    """Lower lid: quadratic through the corners and the low point."""
    (ax, ay), (bx, by), (px, py) = e['A'], e['B'], e['lo']
    t = np.linspace(0, 1, 2000)
    cx, cy = 2 * px - (ax + bx) / 2, 2 * py - (ay + by) / 2
    xs = (1 - t) ** 2 * ax + 2 * (1 - t) * t * cx + t ** 2 * bx
    ys = (1 - t) ** 2 * ay + 2 * (1 - t) * t * cy + t ** 2 * by
    return np.interp(x, xs, ys)


def blur(a, r):
    return np.asarray(Image.fromarray(np.clip(a * 255, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(r))) / 255.0


base = img.copy()
meta = {'width': W, 'height': CROP_H, 'lidSteps': LID_STEPS, 'eyes': []}

for n, e in enumerate(EYES):
    ax, bx = e['A'][0], e['B'][0]
    x0, x1 = int(ax) - 4, int(bx) + 5
    y0 = int(e['up'][1]) - PAD - 2
    y1 = int(max(e['A'][1], e['B'][1], e['lo'][1])) + 6
    bw, bh = x1 - x0, y1 - y0
    xs = np.arange(x0, x1) + 0.5
    U = upper_y(e, np.clip(xs, ax, bx))
    D = lower_y(e, np.clip(xs, ax, bx))
    inside_x = (xs >= ax) & (xs <= bx)
    yy = np.arange(y0, y1)[:, None] + 0.5

    # Eye opening between the lids (anti-aliased by a 1px ramp).
    opening = np.clip(np.minimum(yy - U[None, :], D[None, :] - yy) + 0.5, 0, 1) * inside_x[None, :]
    roi = img[y0:y1, x0:x1]

    # --- Eye white under the iris -------------------------------------------
    cx, cy, r = e['iris'][0], e['iris'][1], e['r']
    gx, gy = np.meshgrid(xs, yy[:, 0])
    in_iris = ((gx - cx) ** 2 + (gy - cy) ** 2) < (r + 4.5) ** 2
    sclera = (opening > 0.99) & ~in_iris & (roi.min(-1) > 110)
    fill = roi.copy()
    rows_ok = []
    keep = fill.copy()
    for i in range(bh):
        s = np.where(sclera[i])[0]
        if len(s) < 4:
            continue
        left, right = s[xs[s] < cx], s[xs[s] > cx]
        cl = np.median(roi[i, left], 0) if len(left) >= 2 else np.median(roi[i, s], 0)
        cr = np.median(roi[i, right], 0) if len(right) >= 2 else cl
        t = np.clip((xs - (cx - r)) / (2 * r), 0, 1)[:, None]
        fill[i] = cl * (1 - t) + cr * t
        rows_ok.append(i)
    # Rows hidden behind the iris all the way across copy the nearest good row.
    for i in range(bh):
        if i not in rows_ok and rows_ok:
            j = min(rows_ok, key=lambda k: abs(k - i))
            fill[i] = fill[j]
    # Outside the iris area keep the real pixels; they are the fill's boundary.
    outside = ((gx - cx) ** 2 + (gy - cy) ** 2) >= (r + 4.5) ** 2
    fill[outside] = keep[outside]
    # Smooth the fill: relax the painted-out area toward the average of its
    # neighbours (a harmonic fill), so the eye white has no row streaks.
    hole = in_iris & (opening > 0.01)
    for _ in range(600):
        nb = (np.roll(fill, 1, 0) + np.roll(fill, -1, 0) + np.roll(fill, 1, 1) + np.roll(fill, -1, 1)) / 4
        fill[hole] = nb[hole]
    paint = blur(in_iris.astype(float), 1.0) * opening
    base[y0:y1, x0:x1] = roi * (1 - paint[..., None]) + fill * paint[..., None]

    # Lid shadow on the eyeball: how much darker each row of eye white is than
    # the brightest, applied over the iris at runtime.
    # Soft shadow just under the upper lid, fading with distance from it.
    below = np.clip(yy - U[None, :], 0, None)
    shade = np.clip(0.42 * np.exp(-below / 7.0) * opening, 0, 1)
    Image.fromarray(np.dstack([np.zeros((bh, bw, 3)), shade * 255]).astype(np.uint8), 'RGBA').save(f'{out}/shade-{n}.png')
    Image.fromarray((opening * 255).astype(np.uint8)).save(f'{out}/open-{n}.png')

    # --- Iris disc ------------------------------------------------------------
    R = int(np.ceil(r)) + 2
    size = 2 * R
    iy, ix = np.mgrid[0:size, 0:size]
    dx, dy = ix + 0.5 - R, iy + 0.5 - R
    rho, th = np.hypot(dx, dy), np.arctan2(dy, dx)
    sx, sy = cx + dx, cy + dy

    def valid(px, py):
        """Visible iris pixel: inside the opening, not a highlight, not lash."""
        px_i = np.clip(np.floor(px).astype(int), 0, W - 1)
        py_i = np.clip(np.floor(py).astype(int), 0, H - 1)
        lx, ly = px_i - x0, py_i - y0
        inb = (lx >= 0) & (lx < bw) & (ly >= 0) & (ly < bh)
        ok = np.zeros(px.shape, bool)
        ok[inb] = opening[ly[inb], lx[inb]] > 0.99
        # Keep away from the lash line, which darkens the iris top.
        ok &= (py - upper_y(e, np.clip(px, ax, bx))) > 3
        for hx, hy, hr in e['hl']:
            ok &= np.hypot(px - hx, py - hy) > hr + 2.5
        return ok, img[py_i, px_i]

    ok, col = valid(sx, sy)
    iris = col.copy()
    # Fill hidden or highlight pixels from the nearest visible angle on the same ring.
    todo = ~ok & (rho < r + 1)
    for step in range(1, 90):
        if not todo.any():
            break
        for sgn in (1, -1):
            a = th + sgn * step * np.pi / 90
            ok2, col2 = valid(cx + rho * np.cos(a), cy + rho * np.sin(a))
            take = todo & ok2
            iris[take] = col2[take]
            todo &= ~take
    alpha = np.clip(r + 0.6 - rho, 0, 1)
    Image.fromarray(np.dstack([iris, alpha * 255]).astype(np.uint8), 'RGBA').save(f'{out}/iris-{n}.png')

    # --- Upper-lid sprite -----------------------------------------------------
    # Each step stretches the strip [U - PAD, U + 1] (lid skin + lash line)
    # down so its edge lands on a curve interpolated toward the lower lid.
    closed_edge = D - 2.5
    frames = []
    for k in range(LID_STEPS):
        b = k / (LID_STEPS - 1)
        b = 0.5 - 0.5 * np.cos(np.pi * b)  # ease the sweep
        edge = U + (closed_edge - U) * b
        top = U - PAD
        frame = np.zeros((bh, bw, 4), np.float32)
        for j in range(bw):
            if not inside_x[j]:
                continue
            ys = np.arange(y0, y1) + 0.5
            # The lash band [U-LASH, U+1] slides down rigidly with the edge;
            # only the skin above it stretches (more toward the bottom).
            d = edge[j] - U[j]
            skin_end = edge[j] - LASH
            t = np.clip((ys - top[j]) / max(skin_end - top[j], 1), 0, 1)
            src_y = np.where(ys < skin_end, ys - d * t ** 1.4, ys - d)
            sj = np.clip(np.floor(src_y).astype(int), 0, H - 1)
            colj = img[sj, int(xs[j])]
            # Opaque from the top of the strip to the moving edge, soft at both ends.
            a = np.clip((edge[j] + 1.2 - ys), 0, 1) * np.clip((ys - top[j]) / 10, 0, 1)
            frame[:, j, :3] = colj
            frame[:, j, 3] = a
        # Fade the sprite out at the eye corners so it blends into the skin.
        cw = np.clip(np.minimum(xs - ax, bx - xs) / 6, 0, 1)
        frame[..., 3] *= cw[None, :]
        frames.append(frame)
    sprite = np.concatenate(frames, 0)
    sprite[..., 3] *= 255
    Image.fromarray(np.clip(sprite, 0, 255).astype(np.uint8), 'RGBA').save(f'{out}/lid-{n}.png')

    meta['eyes'].append({
        'box': [x0, y0, bw, bh],
        'iris': [cx, cy], 'radius': r, 'irisSize': size,
        'highlights': [[hx - cx, hy - cy, hr] for hx, hy, hr in e['hl']],
        # Travel limits for the iris centre (px), inside the opening.
        'rangeX': round((bx - ax) / 2 - r * 0.95, 1),
        'rangeUp': 9, 'rangeDown': 10,
    })

Image.fromarray(np.clip(base[:CROP_H], 0, 255).astype(np.uint8)).save(f'{out}/base.webp', quality=90)
Image.fromarray(img[:CROP_H].astype(np.uint8)).save(f'{out}/poster.webp', quality=82)
with open(f'{out}/character.json', 'w') as f:
    json.dump(meta, f, indent=1)
print(json.dumps(meta))
