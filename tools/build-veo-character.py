"""Build the hero character's frame paths from a Veo clip (Gemini).

Each path runs from a shared front-facing frame out to an extreme pose, so the
player can move along one path and switch paths at the centre without jumps.
Frames are cropped square around the character (which also leaves out the
generator's corner watermark) and saved as WebP.

Usage: python3 tools/build-veo-character.py CLIP.mp4 OUT_DIR
"""
import json, os, subprocess, sys, tempfile
from PIL import Image

clip, out = sys.argv[1], sys.argv[2]
# Measured by eye on the clip (see frame sheets): first index = centre.
PATHS = {
    'left':  list(range(18, 43)),        # real head turn, eyes lead
    'up':    list(range(66, 85)),
    'down':  list(range(98, 109)),       # eyes lowered
    'right': list(range(166, 153, -1)),  # eyes-right glance (no right head turn in this clip)
    'blink': list(range(218, 229)),      # closing; the player reverses it to reopen
}
CROP = (280, 0, 1000, 720)   # square around the character, away from the watermark
SIZE = 720
QUALITY = 74

os.makedirs(out, exist_ok=True)
with tempfile.TemporaryDirectory() as tmp:
    subprocess.run(['ffmpeg', '-v', 'error', '-i', clip, '-start_number', '0', f'{tmp}/%03d.png'], check=True)
    manifest = {'size': SIZE, 'paths': {}}
    for name, idx in PATHS.items():
        files = []
        for k, i in enumerate(idx):
            im = Image.open(f'{tmp}/{i:03d}.png').convert('RGB').crop(CROP).resize((SIZE, SIZE), Image.LANCZOS)
            fn = f'{name}-{k:02d}.webp'
            im.save(f'{out}/{fn}', quality=QUALITY, method=6)
            files.append(fn)
        manifest['paths'][name] = files
    # Average backdrop colour along the top edge, for the hero background.
    im = Image.open(f'{tmp}/000.png').convert('RGB').crop(CROP)
    px = [im.getpixel((x, 4)) for x in range(0, im.width, 8)]
    manifest['backdrop'] = '#%02X%02X%02X' % tuple(sum(c[i] for c in px) // len(px) for i in range(3))
with open(f'{out}/manifest.json', 'w') as f:
    json.dump(manifest, f, indent=1)
print(json.dumps({k: len(v) for k, v in manifest['paths'].items()}), manifest['backdrop'])
