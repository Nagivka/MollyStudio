"""Convert the supplied logos to deterministic Windows and UI icon sizes."""
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent.parent
sources = root / 'design' / 'branding'
output = root / 'src/renderer' / 'assets' / 'images' / 'icon'
output.mkdir(parents=True, exist_ok=True)
for source, stem in [('mslogo.png', 'app'), ('mslogofile.png', 'mlst')]:
    with Image.open(sources / source) as original:
        image = original.convert('RGBA')
        image.save(output / (stem + '.ico'), sizes=[(n,n) for n in (16,20,24,32,40,48,64,128,256)])
        if stem == 'app':
            for size in [64,256]:
                image.resize((size,size), Image.Resampling.LANCZOS).save(output / f'icon{size}.png', optimize=True)
