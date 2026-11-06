"""Build build/icon.ico and build/icon.png from build/icon.svg.

Needs PyMuPDF and Pillow. The results are committed, so this only runs when the mark changes.
Small sizes get a larger ball and heavier seams, which would otherwise vanish at 16 pixels.
"""
import io
from pathlib import Path

import fitz
from PIL import Image

BUILD = Path(__file__).resolve().parent.parent / 'build'
LARGE = {'SIZE_R': '15', 'SEAM': '2'}
SMALL = {'SIZE_R': '17', 'SEAM': '3.4'}
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]


def render(size: int, style: dict[str, str]) -> Image.Image:
    svg = (BUILD / 'icon.svg').read_text(encoding='utf8')
    for key, value in style.items():
        svg = svg.replace(key, value)
    document = fitz.open('pdf', fitz.open('svg', svg.encode('utf8')).convert_to_pdf())
    oversample = 8
    zoom = size * oversample / document[0].rect.width
    pixmap = document[0].get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=True)
    image = Image.open(io.BytesIO(pixmap.tobytes('png'))).convert('RGBA')
    return image.resize((size, size), Image.LANCZOS)


def main() -> None:
    images = [render(s, SMALL if s <= 32 else LARGE) for s in ICO_SIZES]
    render(512, LARGE).save(BUILD / 'icon.png')
    images[-1].save(BUILD / 'icon.ico', format='ICO', append_images=images[:-1], sizes=[(s, s) for s in ICO_SIZES])


if __name__ == '__main__':
    main()
