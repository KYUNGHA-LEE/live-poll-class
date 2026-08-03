"""favicon.svg 와 같은 그림을 ICO / PNG 로 굽는다 (라이브 폴 캐릭터 얼굴)."""
import sys
from PIL import Image, ImageDraw

YELLOW = (255, 226, 40, 255)
INK = (19, 14, 48, 255)
# 분홍 볼: 노란 배경 위 50% 불투명 → 미리 섞어둔다
CHEEK = (
    round(255 * 0.5 + 226 * 0.5),
    round(226 * 0.5 + 97 * 0.5),
    round(40 * 0.5 + 229 * 0.5),
    255,
)

SS = 4  # 슈퍼샘플링 배율 (계단 현상 방지)


def render(size, radius=14):
    """radius=0 이면 모서리를 깎지 않은 꽉 찬 정사각형 (iOS 홈 화면용)."""
    s = size * SS
    k = s / 64.0
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=radius * k, fill=YELLOW)
    for cx in (12, 52):                                   # 볼
        d.ellipse([(cx - 6) * k, 35 * k, (cx + 6) * k, 47 * k], fill=CHEEK)
    for cx in (23, 41):                                   # 눈
        d.ellipse([(cx - 6) * k, 20 * k, (cx + 6) * k, 32 * k], fill=INK)
    d.arc(                                                # 미소
        [24 * k, 31 * k, 40 * k, 47 * k],
        start=20, end=160, fill=INK, width=max(1, round(4.5 * k)),
    )
    return img.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    out = sys.argv[1].rstrip("/\\")
    # iOS 홈 화면 아이콘: 알파 없이 꽉 찬 정사각형 (모서리는 iOS가 깎는다)
    render(180, radius=0).convert("RGB").save(f"{out}/apple-touch-icon.png")
    render(256).save(f"{out}/favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    # PNG 아이콘 — SVG 파비콘을 무시하는 환경(북마크 목록 등)을 위한 보험
    render(32).save(f"{out}/icon-32.png")
    render(192).save(f"{out}/icon-192.png")
    render(512).save(f"{out}/icon-512.png")
    print("ok")
