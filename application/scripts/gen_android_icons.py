"""从 app-icon.png（圆形原图）生成安卓图标。

为什么单独生成：桌面端/网页图标是圆形，而安卓启动器用圆角矩形遮罩，圆形图放进
自适应图标会被放大裁切（m 的字脚被切掉）。这里改为「满铺方形 + 居中 m」，
桌面端与网页图标不受影响。

只依赖 Pillow：`python -m pip install pillow`

用法（仓库根目录）：python application/scripts/gen_android_icons.py
产物：gen/android/app/src/main/res/** 与 icons/android/**（两处保持一致）
"""

import os
import sys
from collections import Counter

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
TAURI = os.path.abspath(os.path.join(HERE, '..', 'src-tauri'))
CIRCLE_SRC = os.path.join(TAURI, 'app-icon.png')
GEN_RES = os.path.join(TAURI, 'gen', 'android', 'app', 'src', 'main', 'res')
SRC_ANDROID = os.path.join(TAURI, 'icons', 'android')

BG = (183, 189, 215)            # #B7BDD7，从原图取样
FG_DARK = (57, 59, 71)          # m 的字色，运行时按原图校正

LEGACY = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
ADAPTIVE = {'mdpi': 108, 'hdpi': 162, 'xhdpi': 216, 'xxhdpi': 324, 'xxxhdpi': 432}

GLYPH_RATIO = 0.688             # 方形图标里 m 宽度 / 画布宽度
SAFE = 72 / 108                 # 自适应图标可见区占 108dp 画布的比例

_glyph = None


def _load_glyph():
    """抽出 m 字形（深色像素）的 alpha 掩码，裁到内容边界。"""
    global _glyph, FG_DARK
    im = Image.open(CIRCLE_SRC).convert('RGBA')
    w, h = im.size
    px = im.load()
    mask = Image.new('L', (w, h), 0)
    mp = mask.load()
    dark = Counter()
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a > 128 and (r * 0.299 + g * 0.587 + b * 0.114) < 130:
                mp[x, y] = 255
                if (r * 0.299 + g * 0.587 + b * 0.114) < 100:
                    dark[(r, g, b)] += 1
    if dark:
        FG_DARK = dark.most_common(1)[0][0]
    _glyph = mask.crop(mask.getbbox())
    return _glyph


def _glyph_at(width_px):
    src = _glyph or _load_glyph()
    k = width_px / src.width
    size = (max(1, round(src.width * k)), max(1, round(src.height * k)))
    return src.resize(size, Image.LANCZOS)


def square_icon(size, ratio=GLYPH_RATIO, circle=False):
    """满铺方块 + 居中 m；circle=True 时裁成圆形（供 ic_launcher_round）。"""
    canvas = Image.new('RGBA', (size, size), BG + (255,))
    g = _glyph_at(size * ratio)
    canvas.paste(FG_DARK + (255,), ((size - g.width) // 2, (size - g.height) // 2), g)
    if not circle:
        return canvas
    k = 4
    clip = Image.new('L', (size * k, size * k), 0)
    ImageDraw.Draw(clip).ellipse((0, 0, size * k - 1, size * k - 1), fill=255)
    clip = clip.resize((size, size), Image.LANCZOS)
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    out.paste(canvas, (0, 0), clip)
    return out


def adaptive_foreground(size):
    """透明底前景层；m 缩进 72dp 安全区，避免被遮罩裁到。"""
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    g = _glyph_at(size * SAFE * GLYPH_RATIO)
    canvas.paste(FG_DARK + (255,), ((size - g.width) // 2, (size - g.height) // 2), g)
    return canvas


def monochrome(size):
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    g = _glyph_at(size * SAFE * GLYPH_RATIO)
    canvas.paste(Image.new('RGBA', g.size, (0, 0, 0, 255)),
                 ((size - g.width) // 2, (size - g.height) // 2), g)
    return canvas


ADAPTIVE_XML = """<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
  <background android:drawable="@color/ic_launcher_background"/>
  <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
  <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>
</adaptive-icon>
"""

COLOR_XML = """<?xml version="1.0" encoding="utf-8"?>
<resources>
  <color name="ic_launcher_background">#B7BDD7</color>
</resources>
"""


def _save(path, img):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, 'PNG', optimize=True)


def _text(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(text)


def _build(res_dir, with_background=True):
    for d, s in LEGACY.items():
        _save(os.path.join(res_dir, f'mipmap-{d}', 'ic_launcher.png'), square_icon(s))
        _save(os.path.join(res_dir, f'mipmap-{d}', 'ic_launcher_round.png'),
              square_icon(s, GLYPH_RATIO * 0.95, circle=True))
    for d, s in ADAPTIVE.items():
        _save(os.path.join(res_dir, f'mipmap-{d}', 'ic_launcher_foreground.png'), adaptive_foreground(s))
        _save(os.path.join(res_dir, f'mipmap-{d}', 'ic_launcher_monochrome.png'), monochrome(s))
        if with_background:
            _save(os.path.join(res_dir, f'mipmap-{d}', 'ic_launcher_background.png'),
                  Image.new('RGBA', (s, s), BG + (255,)))
    _text(os.path.join(res_dir, 'mipmap-anydpi-v26', 'ic_launcher.xml'), ADAPTIVE_XML)
    _text(os.path.join(res_dir, 'values', 'ic_launcher_background.xml'), COLOR_XML)


def main():
    if not os.path.exists(CIRCLE_SRC):
        sys.exit(f'找不到源图: {CIRCLE_SRC}')
    _load_glyph()

    _build(GEN_RES)                      # 实际打包目录
    _build(os.path.join(SRC_ANDROID, 'res'))
    _build(SRC_ANDROID, with_background=False)
    _save(os.path.join(SRC_ANDROID, 'play_store_512.png'), square_icon(512))
    print('android icons rebuilt ->', GEN_RES)


if __name__ == '__main__':
    main()
