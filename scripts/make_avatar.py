# 生成小程序头像 avatar.png（512x512）
# 「有个回音」：墨色气泡 + 正在输入的圆点 + 右侧渐淡的回声弧
from PIL import Image, ImageDraw

S = 512
img = Image.new("RGB", (S, S))
d = ImageDraw.Draw(img)

# 垂直渐变：#FBF7F0 -> #EFE4D3
top, bot = (251, 247, 240), (239, 228, 211)
for y in range(S):
    t = y / S
    c = tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3))
    d.line([(0, y), (S, y)], fill=c)

INK = (51, 48, 43)       # #33302B
CLAY = (196, 117, 78)    # #C4754E 陶土色


def blend(c1, c2, t):
    return tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))


# ---- 气泡主体（偏左，给回声弧留空间）----
bx0, by0, bx1, by1 = 78, 150, 348, 334
cy = (by0 + by1) // 2
d.rounded_rectangle([bx0, by0, bx1, by1], radius=62, fill=INK)

# 气泡尾巴（左下）
d.polygon([(150, by1 - 28), (122, 402), (212, by1 - 4)], fill=INK)

# ---- 气泡内：三个"正在输入"的圆点 ----
dot_r = 15
for i, x in enumerate((170, 213, 256)):
    fade = 0.15 * i  # 由深到浅，像话还没说完
    d.ellipse(
        [x - dot_r, cy - dot_r, x + dot_r, cy + dot_r],
        fill=blend(CLAY, INK, fade + 0.55),
    )

# ---- 回声弧：以气泡右缘为圆心向右荡开，越远越淡 ----
arc_cx = bx1 - 6
for radius, w, fade in ((46, 14, 0.0), (88, 12, 0.45), (128, 10, 0.7)):
    d.arc(
        [arc_cx - radius, cy - radius, arc_cx + radius, cy + radius],
        start=-58,
        end=58,
        fill=blend(CLAY, bot, fade),
        width=w,
    )

img.save("avatar.png")
img.resize((144, 144), Image.LANCZOS).save("avatar_144.png")
print("done: avatar.png, avatar_144.png")
