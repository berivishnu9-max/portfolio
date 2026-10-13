"""One-off: move the legacy portfolio pages onto the Strategic Consultant palette.
60% canvas #FAF9F6, 30% charcoal #2C302E, 10% gold #D4AF37 (fills), with a deep
gold #8A6D1A for gold *text*, since #D4AF37 on the canvas is only ~2:1."""
import re, sys

def retheme(s):
    s = s.replace('%230a0a0a', '%232C302E').replace('%23E4011F', '%23D4AF37')
    s = s.replace('<meta name="theme-color" content="#0a0a0a">', '<meta name="theme-color" content="#FAF9F6">')
    s = s.replace('--bg:#0a0a0a;', '--bg:#FAF9F6;')
    s = s.replace('--fg:#f0f0f0;', '--fg:#2C302E;')
    s = re.sub(r'--accent:#FF2E44;', '--accent:#8A6D1A;--gold:#D4AF37;', s, flags=re.I)
    # Accent used as a surface or rule -> the true gold; as text it stays deep gold.
    s = re.sub(r'background:\s*var\(--accent\)', 'background:var(--gold)', s)
    s = re.sub(r'(border(?:-[a-z]+)?:[^;{}]*?)var\(--accent\)', r'\1var(--gold)', s)
    s = re.sub(r'#FF2E44', '#D4AF37', s, flags=re.I)
    s = s.replace('rgba(255,46,68,', 'rgba(212,175,55,')
    s = s.replace('rgba(240,240,240,', 'rgba(44,48,46,')
    s = re.sub(r'#f0f0f0', '#2C302E', s, flags=re.I)
    s = s.replace('linear-gradient(145deg,#0d1626 0%,#0e0e0e 55%)', 'linear-gradient(145deg,#F4EEDC 0%,#FFFFFF 55%)')
    s = re.sub(r'#(0d0d0d|101010|111)\b', '#FFFFFF', s, flags=re.I)
    s = s.replace('rgba(13,13,13,.88)', 'rgba(255,255,255,.92)')
    s = s.replace('rgba(10,10,10,.92)', 'rgba(250,249,246,.92)')
    s = re.sub(r'#0a0a0a', '#2C302E', s, flags=re.I)   # text on gold fills
    s = s.replace('rgba(10,10,10,', 'rgba(250,249,246,')  # glass panels, text halos
    s = s.replace('box-shadow:0 18px 48px rgba(0,0,0,.4)', 'box-shadow:0 18px 48px rgba(44,48,46,.12)')
    return s

for p in sys.argv[1:]:
    with open(p) as f:
        text = f.read()
    with open(p, 'w') as f:
        f.write(retheme(text))
