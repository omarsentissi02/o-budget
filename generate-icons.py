# Génère les icônes PNG de l'application (Pillow requis : pip install pillow).
from PIL import Image, ImageDraw

BLUE = (47, 69, 216, 255)
WHITE = (255, 255, 255, 255)

def icon(size, maskable=False, radius_ratio=0.22):
    s = 4  # suréchantillonnage pour des bords lisses
    S = size * s
    img = Image.new("RGBA", (S, S), BLUE if maskable else (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if not maskable:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * radius_ratio), fill=BLUE)
    scale = 0.78 if maskable else 1.0  # zone de sécurité pour les icônes adaptatives
    cx, cy = S / 2, S * (0.469 if not maskable else 0.48)
    r = S * 0.23 * scale
    w = S * 0.1 * scale
    d.ellipse([cx - r - w / 2, cy - r - w / 2, cx + r + w / 2, cy + r + w / 2], fill=WHITE)
    d.ellipse([cx - r + w / 2, cy - r + w / 2, cx + r - w / 2, cy + r - w / 2], fill=BLUE)
    bw, bh = S * 0.414 * scale, S * 0.066 * scale
    by = cy + r + w / 2 + S * 0.06 * scale
    bar = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(bar).rounded_rectangle([cx - bw / 2, by, cx + bw / 2, by + bh], radius=bh / 2, fill=(255, 255, 255, 140))
    img = Image.alpha_composite(img, bar)
    return img.resize((size, size), Image.LANCZOS)

icon(192).save("public/icons/icon-192.png")
icon(512).save("public/icons/icon-512.png")
icon(512, maskable=True).save("public/icons/icon-maskable-512.png")
full = icon(180, maskable=True)  # iOS arrondit lui-même les coins
full.save("public/icons/apple-touch-icon.png")
print("icônes générées")
