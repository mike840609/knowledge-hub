"""Build the README banner: the app icon, title and tagline, with text as paths.

Writes docs/images/banner-light.svg and docs/images/banner-dark.svg from the
vendored Inter (src/app/font-assets) so the banner looks the same everywhere.
Colours follow the --kh-* tokens in src/app/globals.css; the three edge/node
greys are banner-only. Run from the repository root:

    python3 -m venv /tmp/banner-venv
    /tmp/banner-venv/bin/pip install fonttools brotli uharfbuzz
    /tmp/banner-venv/bin/python -I scripts/docs/build-banner.py
"""
import io
from pathlib import Path

import uharfbuzz as hb
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

FONT = Path("src/app/font-assets/inter-latin-variable.woff2")
OUT = Path("docs/images")
TITLE, TAGLINE = "Knowledge Hub", "Markdown notes, connected and shared."
W, H, ICON, GAP = 1280, 320, 132, 40

THEMES = {
    "light": {"bg": "#fafbfc", "border": "#e5e7ee", "ink": "#1d1f24", "accent": "#4f5bc8",
              "muted": "#61697a", "edge": "#dfe1e7", "node": "#d4d7e0"},
    "dark": {"bg": "#191a1e", "border": "#303239", "ink": "#e7e8ec", "accent": "#5e6ad2",
             "muted": "#9ba2b0", "edge": "#2a2d34", "node": "#34373f"},
}


def num(x):
    return f"{x:.1f}".rstrip("0").rstrip(".")


def text_path(weight, text, size, x, baseline, tracking):
    font = instantiateVariableFont(TTFont(FONT), {"wght": weight})
    font.flavor = None
    data = io.BytesIO()
    font.save(data)
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(hb.Font(hb.Face(data.getvalue())), buf, {"kern": True, "liga": True})
    upem = font["head"].unitsPerEm
    scale = size / upem
    glyphs, order = font.getGlyphSet(), font.getGlyphOrder()
    pen = SVGPathPen(glyphs, ntos=num)
    cursor = 0
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        t = (scale, 0, 0, -scale, x + (cursor + pos.x_offset) * scale, baseline)
        glyphs[order[info.codepoint]].draw(TransformPen(pen, t))
        cursor += pos.x_advance + tracking * upem
    return pen.getCommands(), (cursor - tracking * upem) * scale


def constellation(cx, cy, flip, c):
    s = -1 if flip else 1
    pts = [(cx + s * px, cy + py) for px, py in [(0, 0), (70, -48), (118, 26), (40, 70), (150, -70)]]
    lines = "".join(
        f'<line x1="{pts[a][0]}" y1="{pts[a][1]}" x2="{pts[b][0]}" y2="{pts[b][1]}"/>'
        for a, b in [(0, 1), (0, 2), (0, 3), (1, 4), (1, 2)]
    )
    dots = "".join(f'<circle cx="{x}" cy="{y}" r="{r}"/>' for (x, y), r in zip(pts, [7, 5, 6, 4, 3.5]))
    return f'<g stroke="{c["edge"]}" stroke-width="2">{lines}</g><g fill="{c["node"]}">{dots}</g>'


def main():
    _, title_w = text_path(680, TITLE, 76, 0, 0, -0.022)
    _, tag_w = text_path(420, TAGLINE, 27, 0, 0, -0.005)
    x0 = (W - (ICON + GAP + max(title_w, tag_w))) / 2
    tx = x0 + ICON + GAP
    title, _ = text_path(680, TITLE, 76, tx, 166, -0.022)
    tag, _ = text_path(420, TAGLINE, 27, tx, 216, -0.005)
    for name, c in THEMES.items():
        svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" role="img" aria-labelledby="t d">
<title id="t">{TITLE}</title>
<desc id="d">{TAGLINE}</desc>
<rect x="1" y="1" width="{W - 2}" height="{H - 2}" rx="24" fill="{c["bg"]}" stroke="{c["border"]}" stroke-width="2"/>
{constellation(96, 236, False, c)}
{constellation(W - 96, 84, True, c)}
<g transform="translate({num(x0)} {num((H - ICON) / 2)}) scale({ICON / 32})">
<path d="M15 17.5 6.75 8.5M15 17.5l10.25-7.75M15 17.5l9 8" fill="none" stroke="{c["ink"]}" stroke-width="2.75" stroke-linecap="round"/>
<circle cx="15" cy="17.5" r="6.25" fill="{c["accent"]}"/>
<g fill="{c["ink"]}"><circle cx="6.75" cy="8.5" r="3.75"/><circle cx="25.25" cy="9.75" r="2.75"/><circle cx="24" cy="25.5" r="3.25"/></g>
</g>
<path fill="{c["ink"]}" d="{title}"/>
<path fill="{c["muted"]}" d="{tag}"/>
</svg>
'''
        path = OUT / f"banner-{name}.svg"
        path.write_text(svg)
        print(f"{path}: {len(svg.encode()) / 1024:.1f} KiB")


if __name__ == "__main__":
    main()
