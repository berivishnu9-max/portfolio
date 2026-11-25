"""Turn the Veo clips of the character into frame atlases for the live avatar.

    python3 tools/build-clips.py <clips-dir> [--tile 360]

<clips-dir> holds nine MP4s named like the end frame they were made from:
01-left, 02-right, 03-up, 04-down, 05-up-left, 06-up-right, 07-down-left,
08-down-right (each starts on the front pose and ends on that direction) and
09-idle (starts and ends on the front pose, with blinks and a little movement).
The character is on flat green, centred, bottom-aligned, as in the kit's frames.

For each clip this samples frames evenly, crops the character's square, keys out the
green (with despill), and lays the frames out in a grid atlas in public/clips/.
The shoulders of every frame are then replaced by the idle clip's first frame below the
neck, so the body is exactly still whatever the video did. public/clips/manifest.json
tells the player what exists; with no manifest the site uses the sprite character.
"""
import json
import os
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEST = os.path.join(ROOT, 'public', 'clips')
DIRS = ['left', 'right', 'up', 'down', 'up-left', 'up-right', 'down-left', 'down-right']
PATH_FRAMES = 24    # frames kept along a turn
IDLE_FPS = 12       # idle loop sampling rate
NECK = (0.66, 0.80)  # body is the reference below the neck, blended across this band


def probe(path):
    out = subprocess.check_output(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries',
                                   'stream=width,height,nb_frames,duration', '-of', 'json', path])
    s = json.loads(out)['streams'][0]
    return int(s['width']), int(s['height']), float(s['duration'])


def extract(path, count, tile):
    """`count` frames sampled evenly over the clip, as RGB arrays cropped to the character."""
    w, h, dur = probe(path)
    # the kit places a 1000px character in a 1080px-high frame, bottom aligned and centred
    side = round(h * 1000 / 1080)
    x0, y0 = (w - side) // 2, h - side
    with tempfile.TemporaryDirectory() as tmp:
        fps = count / dur
        subprocess.check_call(['ffmpeg', '-v', 'error', '-i', path, '-vf',
                               f'fps={fps:.6f},crop={side}:{side}:{x0}:{y0},scale={tile}:{tile}:flags=lanczos',
                               '-frames:v', str(count), f'{tmp}/%04d.png'])
        files = sorted(os.listdir(tmp))
        frames = [np.asarray(Image.open(f'{tmp}/{f}').convert('RGB')) for f in files]
    while len(frames) < count:      # rounding can drop the last frame
        frames.append(frames[-1])
    return frames[:count]


def key(rgb):
    """Chroma-key the green screen: alpha from how far green exceeds red and blue, then
    unmix the screen colour out of partly covered pixels so soft edges carry no green."""
    a = rgb.astype(np.float32)
    corners = np.concatenate([a[:8, :8].reshape(-1, 3), a[:8, -8:].reshape(-1, 3)])
    screen = np.median(corners, axis=0)                       # the flat green, measured per frame
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    spill = g - np.maximum(r, b)
    full = screen[1] - max(screen[0], screen[2])               # spill of pure screen
    alpha = np.clip(1.0 - (spill - 4.0) / max(full - 10.0, 1.0), 0.0, 1.0)
    safe = np.maximum(alpha, 0.05)[..., None]
    out = np.where(alpha[..., None] < 0.98, (a - (1 - safe) * screen) / safe, a)
    # green never exceeds the red/blue average: true skin, hair and white all satisfy this, screen spill does not
    out[..., 1] = np.minimum(out[..., 1], (out[..., 0] + out[..., 2]) / 2 + 2)
    return np.dstack([out, alpha * 255]).clip(0, 255).astype(np.uint8)


def pin_body(frame, ref):
    """Below the neck take the reference frame, above it the video, blended across NECK."""
    h = frame.shape[0]
    y = np.arange(h, dtype=np.float32)[:, None, None] / h
    w = np.clip((y - NECK[0]) / (NECK[1] - NECK[0]), 0, 1)   # 0 = keep video, 1 = use reference
    f, r = frame.astype(np.float32), ref.astype(np.float32)
    fa, ra = f[..., 3:4], r[..., 3:4]
    # blend premultiplied so soft edges mix correctly
    mixed = (f[..., :3] * fa / 255 * (1 - w) + r[..., :3] * ra / 255 * w)
    alpha = fa * (1 - w) + ra * w
    rgb = np.where(alpha > 1e-3, mixed / np.maximum(alpha / 255, 1e-3), 0)
    return np.dstack([rgb, alpha]).clip(0, 255).astype(np.uint8)


def atlas(frames, cols, tile):
    rows = -(-len(frames) // cols)
    sheet = Image.new('RGBA', (cols * tile, rows * tile), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        sheet.paste(Image.fromarray(f, 'RGBA'), ((i % cols) * tile, (i // cols) * tile))
    return sheet


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    src = sys.argv[1]
    tile = int(sys.argv[sys.argv.index('--tile') + 1]) if '--tile' in sys.argv else 360
    names = {f.split('-', 1)[1].rsplit('.', 1)[0]: os.path.join(src, f)
             for f in sorted(os.listdir(src)) if f.lower().endswith('.mp4') and '-' in f}
    missing = [n for n in DIRS + ['idle'] if n not in names]
    if 'idle' not in names:
        sys.exit('09-idle.mp4 is required: its first frame is the still body every other frame is pinned to')
    os.makedirs(DEST, exist_ok=True)

    _, _, idle_dur = probe(names['idle'])
    idle_count = max(12, round(idle_dur * IDLE_FPS))
    idle = [key(f) for f in extract(names['idle'], idle_count, tile)]
    ref = idle[0]
    manifest = {'tile': tile, 'paths': {}, 'idle': None}

    def save(name, frames, cols):
        frames = [pin_body(f, ref) for f in frames]
        sheet = atlas(frames, cols, tile)
        path = os.path.join(DEST, f'{name}.webp')
        sheet.save(path, quality=80, method=6)
        print(f'  {name:11s} {len(frames):3d} frames  {os.path.getsize(path) // 1024} KB')
        return {'frames': len(frames), 'cols': cols}

    manifest['idle'] = dict(save('idle', idle, 8), fps=IDLE_FPS)
    for d in DIRS:
        if d in names:
            frames = [key(f) for f in extract(names[d], PATH_FRAMES, tile)]
            manifest['paths'][d] = save(d, frames, 6)
    with open(os.path.join(DEST, 'manifest.json'), 'w') as fh:
        json.dump(manifest, fh, indent=1)
    if missing:
        print('  not provided, so those directions use the sprite poses:', ', '.join(m for m in missing if m != 'idle'))


main()
