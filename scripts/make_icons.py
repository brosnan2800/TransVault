# -*- coding: utf-8 -*-
"""生成 TransVault 占位图标 icon16/32/48/128.png
优先使用 PIL 绘制（圆角底 + 白色「译」字），否则退化为纯色圆角方块（纯 stdlib）。
"""
import os
import struct
import sys
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "src", "icons")
SIZES = [16, 32, 48, 128]

BG = (79, 70, 229)      # indigo #4F46E5
FG = (255, 255, 255)    # white


def write_png(path, w, h, rgba_rows):
    """rgba_rows: list of rows, each row = bytes of RGBA pixels."""
    raw = b"".join(b"\x00" + row for row in rgba_rows)
    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


def rounded_mask(size, radius):
    """返回 size*size 的 bool 矩阵：圆角矩形内为 True。"""
    m = [[False] * size for _ in range(size)]
    r2 = radius * radius
    for y in range(size):
        for x in range(size):
            # 判断点是否在圆角矩形内
            dx = dy = 0
            cx, cy = x + 0.5, y + 0.5
            if cx < radius and cy < radius:
                dx, dy = radius - cx, radius - cy
            elif cx > size - radius and cy < radius:
                dx, dy = cx - (size - radius), radius - cy
            elif cx < radius and cy > size - radius:
                dx, dy = radius - cx, cy - (size - radius)
            elif cx > size - radius and cy > size - radius:
                dx, dy = cx - (size - radius), cy - (size - radius)
            m[y][x] = (dx * dx + dy * dy) <= r2 if (dx or dy) else True
    return m


def make_stdlib(size):
    """无 PIL：纯色圆角方块，中间画一个简化的白色方块代表文字块。"""
    mask = rounded_mask(size, max(2, size // 5))
    pad = max(1, size // 8)
    inner = size - 2 * pad
    bar_h = max(1, inner // 4)
    gap = max(1, inner // 12)
    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            inside = mask[y][x]
            # 中间画两条白横条模拟文本行
            iy = y - pad
            is_bar1 = pad <= y < pad + bar_h
            is_bar2 = pad + bar_h + gap <= y < pad + 2 * bar_h + gap
            ix = x - pad
            is_text = is_bar1 or (is_bar2 and ix < inner // 2)
            if inside and is_text:
                row += bytes(FG) + bytes([255])
            elif inside:
                row += bytes(BG) + bytes([255])
            else:
                row += bytes([0, 0, 0, 0])
        rows.append(bytes(row))
    return rows


def make_pil(size):
    from PIL import Image, ImageDraw, ImageFont
    scale = 4  # 超采样抗锯齿
    S = size * scale
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = S // 5
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=r, fill=BG + (255,))
    # 找一个可用的中文字体
    font = None
    candidates = [
        "C:/Windows/Fonts/msyh.ttc",
        "C:/Windows/Fonts/msyhbd.ttc",
        "C:/Windows/Fonts/simhei.ttf",
        "C:/Windows/Fonts/simsun.ttc",
    ]
    fsize = int(S * 0.62)
    for path in candidates:
        if os.path.exists(path):
            try:
                font = ImageFont.truetype(path, fsize)
                break
            except Exception:
                continue
    if font is None:
        font = ImageFont.load_default()
    text = "译"
    bbox = d.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text(((S - tw) / 2 - bbox[0], (S - th) / 2 - bbox[1]), text,
           font=font, fill=FG + (255,))
    img = img.resize((size, size), Image.LANCZOS)
    return img


def main():
    os.makedirs(OUT, exist_ok=True)
    use_pil = False
    try:
        import PIL  # noqa: F401
        use_pil = True
    except ImportError:
        pass
    for s in SIZES:
        path = os.path.join(OUT, f"icon{s}.png")
        if use_pil:
            make_pil(s).save(path)
        else:
            write_png(path, s, s, make_stdlib(s))
        print(f"OK {path} ({'PIL' if use_pil else 'stdlib'})")


if __name__ == "__main__":
    main()