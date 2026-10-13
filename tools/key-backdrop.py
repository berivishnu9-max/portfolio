# Replace the saturated red backdrop with the canvas colour.
#  1. Core matte from saturation + redness: backdrop ~(228,1,31) has sat ~1.0;
#     skin, lips and hair are far less saturated, so they survive.
#  2. In a thin band around the core, edge pixels are part backdrop: estimate
#     how much red is mixed in and un-mix it, which removes the red fringe.
import sys, subprocess, numpy as np
src, dst, W, H = sys.argv[1], sys.argv[2], 1504, 1376
CANVAS = np.array([0xFA, 0xF9, 0xF6], np.float32)
RED = np.array([228, 1, 31], np.float32)

def dilate(m, r):
    out = m.copy()
    for axis in (0, 1):
        acc = out.copy()
        for d in range(1, r + 1):
            acc |= np.roll(out, d, axis) | np.roll(out, -d, axis)
        out = acc
    return out

dec = subprocess.Popen(['ffmpeg','-v','error','-i',src,'-f','rawvideo','-pix_fmt','rgb24','-'], stdout=subprocess.PIPE)
enc = subprocess.Popen(['ffmpeg','-v','error','-y','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r','24','-i','-',
                        '-c:v','libx264','-crf','14','-preset','fast','-pix_fmt','yuv444p',dst], stdin=subprocess.PIPE)
n = 0
while True:
    buf = dec.stdout.read(W*H*3)
    if len(buf) < W*H*3: break
    f = np.frombuffer(buf, np.uint8).reshape(H, W, 3).astype(np.float32)
    r, g, b = f[...,0], f[...,1], f[...,2]
    mx = f.max(-1); mn = f.min(-1)
    sat = (mx - mn) / np.maximum(mx, 1)
    redness = (r - np.maximum(g, b)) / 255.0
    a = np.clip((sat - 0.72) / 0.18, 0, 1) * np.clip((redness - 0.45) / 0.2, 0, 1)
    core = a > 0.5
    band = dilate(core, 5) & ~core
    a_edge = np.clip((redness - 0.10) / 0.67, 0, 0.98) * np.clip((sat - 0.35) / 0.3, 0, 1)
    # Shirt edges: white mixed with red keeps g ~ b (skin has g well above b),
    # so the red share can be read off the green channel against shirt white.
    shirt_mix = band & (np.abs(g - b) < 25) & (g > 60)
    a_shirt = np.clip(1 - g / 228.0, 0, 0.98)
    a_edge = np.where(shirt_mix, np.maximum(a_edge, a_shirt), a_edge)
    a = np.where(band, np.maximum(a, a_edge), a)
    a3 = a[..., None]
    fg = (f - a3 * RED) / np.maximum(1 - a3, 0.02)
    fg = np.clip(fg, 0, 255)
    # The red backdrop bounced pink light onto the shirt; neutralise light,
    # near-grey pixels so it reads as white against the off-white canvas.
    fr, fgc, fb = fg[...,0], fg[...,1], fg[...,2]
    light = (np.minimum(fgc, fb) > 150) & (np.abs(fgc - fb) < 22)
    cast = np.clip(fr - np.maximum(fgc, fb), 0, None)
    fg[...,0] = np.where(light, fr - cast * 0.85, fr)
    out = fg * (1 - a3) + CANVAS * a3
    enc.stdin.write(np.clip(out, 0, 255).astype(np.uint8).tobytes()); n += 1
enc.stdin.close(); enc.wait(); print('frames', n)
