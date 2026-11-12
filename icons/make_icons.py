# アイコン生成（開発用）: python icons/make_icons.py
from PIL import Image, ImageDraw, ImageFont
import os
here = os.path.dirname(os.path.abspath(__file__))
def make(size, name, pad=0):
    img = Image.new("RGB", (size, size), (24, 95, 165))
    d = ImageDraw.Draw(img)
    s = size / 512
    # 車のシルエット（軽ハイトワゴン風）
    d.rounded_rectangle([96*s, 170*s, 416*s, 330*s], radius=40*s, fill=(255, 255, 255))
    d.rounded_rectangle([130*s, 120*s, 360*s, 200*s], radius=30*s, fill=(255, 255, 255))
    d.rounded_rectangle([150*s, 138*s, 245*s, 190*s], radius=10*s, fill=(24, 95, 165))
    d.rounded_rectangle([258*s, 138*s, 342*s, 190*s], radius=10*s, fill=(24, 95, 165))
    for cx in (170, 342):
        d.ellipse([(cx-42)*s, 290*s, (cx+42)*s, 374*s], fill=(12, 68, 124))
        d.ellipse([(cx-18)*s, 314*s, (cx+18)*s, 350*s], fill=(230, 230, 230))
    try:
        f = ImageFont.truetype("C:/Windows/Fonts/YuGothB.ttc", int(60*s))
    except Exception:
        f = ImageFont.load_default()
    d.text((256*s, 430*s), "維持費", font=f, fill=(255, 255, 255), anchor="mm")
    img.save(os.path.join(here, name))
make(512, "icon-512.png"); make(192, "icon-192.png"); make(180, "apple-touch-icon.png")
