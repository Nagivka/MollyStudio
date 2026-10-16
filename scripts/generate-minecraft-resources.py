"""Render bundled block models from a local vanilla resource pack (Pillow only).

No source pack files are changed. GUI transforms, inherited elements/textures,
UV rotation, element rotation, alpha, first animation frames and item tints are
resolved offline. Entity/special renderers are deliberately reported as skipped.
Run: python scripts/generate-minecraft-resources.py "path/to/pack" --version 26.3
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
from functools import lru_cache
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SIZE = 64


def rotate(point, axis, angle):
    point = list(point)
    a, b = {'x': (1, 2), 'y': (2, 0), 'z': (0, 1)}[axis]
    c, s = math.cos(math.radians(angle)), math.sin(math.radians(angle))
    point[a], point[b] = point[a] * c - point[b] * s, point[a] * s + point[b] * c
    return point


class Renderer:
    def __init__(self, pack):
        self.assets = pack / 'assets'
        self.sources = {}

    def asset(self, value, kind, extension):
        namespace, name = value.split(':', 1) if ':' in value else ('minecraft', value)
        if any(part in ('..', '') for part in name.split('/')) or not namespace.isidentifier():
            raise ValueError('Unsafe asset identifier')
        file = self.assets / namespace / kind / (name + extension)
        data = file.read_bytes()
        self.sources[str(file.relative_to(self.assets)).replace('\\', '/')] = hashlib.sha256(data).hexdigest()
        return file, data

    @lru_cache(maxsize=4096)
    def model(self, name, ancestors=()):
        if name in ('builtin/generated', 'minecraft:builtin/generated'):
            raise ValueError('Flat item sprite (already represented by item assets where available)')
        if name in ancestors or len(ancestors) > 32:
            raise ValueError('Cyclic model inheritance')
        _, data = self.asset(name, 'models', '.json')
        own = json.loads(data)
        parent = self.model(own['parent'], ancestors + (name,)) if 'parent' in own else {}
        result = {**parent, **own}
        for field in ('textures', 'display'):
            result[field] = {**parent.get(field, {}), **own.get(field, {})}
        return result

    @lru_cache(maxsize=2048)
    def texture(self, name):
        file, _ = self.asset(name, 'textures', '.png')
        image = Image.open(file).convert('RGBA')
        metadata = file.with_suffix('.png.mcmeta')
        if metadata.exists():
            data = metadata.read_bytes()
            self.sources[str(metadata.relative_to(self.assets)).replace('\\', '/')] = hashlib.sha256(data).hexdigest()
            animation = json.loads(data).get('animation')
            if animation is not None:
                width = animation.get('width', image.width if 'height' in animation else min(image.size))
                height = animation.get('height', image.height if 'width' in animation else min(image.size))
                frame = animation.get('frames', [0])[0]
                index = frame.get('index', 0) if isinstance(frame, dict) else frame
                columns = image.width // width
                x, y = index % columns * width, index // columns * height
                image = image.crop((x, y, x + width, y + height))
        return image

    def tint(self, tints, index):
        if index is None or index >= len(tints):
            return (255, 255, 255)
        tint = tints[index]
        kind = tint.get('type', '').split(':')[-1]
        if kind == 'constant':
            value = tint['value']
            return ((value >> 16) & 255, (value >> 8) & 255, value & 255)
        if kind == 'grass':
            image = self.texture('minecraft:colormap/grass')
            temperature = max(0, min(1, tint.get('temperature', .5)))
            rainfall = max(0, min(1, tint.get('downfall', 1))) * temperature
            return image.getpixel((int((1 - temperature) * (image.width - 1)), int((1 - rainfall) * (image.height - 1))))[:3]
        return (255, 255, 255)

    def render(self, name, tints):
        model = self.model(name)
        elements = model.get('elements', [])
        if not elements:
            raise ValueError('No block geometry')
        transform = model.get('display', {}).get('gui', {})
        angles = transform.get('rotation', [30, 225, 0])
        scale = transform.get('scale', [.625] * 3)
        translation = transform.get('translation', [0] * 3)
        fragments = [[] for _ in range(SIZE * SIZE)]
        face_id = 0

        def project(point, element_rotation=None):
            if element_rotation:
                origin = element_rotation.get('origin', [8, 8, 8])
                axis, angle = element_rotation['axis'], element_rotation['angle']
                point = rotate([point[i] - origin[i] for i in range(3)], axis, angle)
                if element_rotation.get('rescale'):
                    factor = 1 / math.cos(math.radians(angle))
                    point = [value if 'xyz'[i] == axis else value * factor for i, value in enumerate(point)]
                point = [point[i] + origin[i] for i in range(3)]
            point = [(point[i] - 8) * scale[i] for i in range(3)]
            for axis, angle in [('y', angles[1]), ('x', angles[0]), ('z', angles[2])]:
                point = rotate(point, axis, angle)
            point = [point[i] + translation[i] for i in range(3)]
            return (SIZE / 2 + point[0] * SIZE / 16, SIZE / 2 - point[1] * SIZE / 16, point[2])

        for element in elements:
            x0, y0, z0 = element['from']
            x1, y1, z1 = element['to']
            corners = {
                'south': [(x0,y1,z1),(x0,y0,z1),(x1,y0,z1),(x1,y1,z1)],
                'north': [(x1,y1,z0),(x1,y0,z0),(x0,y0,z0),(x0,y1,z0)],
                'east': [(x1,y1,z1),(x1,y0,z1),(x1,y0,z0),(x1,y1,z0)],
                'west': [(x0,y1,z0),(x0,y0,z0),(x0,y0,z1),(x0,y1,z1)],
                'up': [(x0,y1,z0),(x0,y1,z1),(x1,y1,z1),(x1,y1,z0)],
                'down': [(x0,y0,z1),(x0,y0,z0),(x1,y0,z0),(x1,y0,z1)],
            }
            default_uv = {'up':[x0,z0,x1,z1], 'down':[x0,16-z1,x1,16-z0], 'north':[16-x1,16-y1,16-x0,16-y0], 'south':[x0,16-y1,x1,16-y0], 'west':[z0,16-y1,z1,16-y0], 'east':[16-z1,16-y1,16-z0,16-y0]}
            for side, face in element.get('faces', {}).items():
                face_id += 1
                points = [project(point, element.get('rotation')) for point in corners[side]]
                # Clockwise screen polygon means a front-facing model face.
                a, b, c = points[:3]
                cross = (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
                if cross >= -1e-8:
                    continue
                texture_name = face['texture']
                visited = set()
                while isinstance(texture_name, str) and texture_name.startswith('#'):
                    if texture_name in visited:
                        raise ValueError('Cyclic texture reference')
                    visited.add(texture_name)
                    texture_name = model['textures'][texture_name[1:]]
                if isinstance(texture_name, dict):
                    texture_name = texture_name['sprite']
                texture = self.texture(texture_name)
                texels = texture.load()
                u0, v0, u1, v1 = face.get('uv', default_uv[side])
                uvs = [(u0,v0),(u0,v1),(u1,v1),(u1,v0)]
                offset = (face.get('rotation', 0) // 90) % 4
                uvs = uvs[-offset:] + uvs[:-offset] if offset else uvs
                tint = self.tint(tints, face.get('tintindex'))
                shade = 1 if model.get('gui_light') == 'front' or element.get('shade') is False else {'up':1,'down':.55,'north':.78,'south':.78,'east':.64,'west':.64}[side]
                covered = set()
                for indices in ((0,1,2),(0,2,3)):
                    a,b,c = [points[i] for i in indices]
                    denom = (b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
                    if abs(denom) < 1e-8:
                        continue
                    for y in range(max(0,math.floor(min(a[1],b[1],c[1]))),min(SIZE,math.ceil(max(a[1],b[1],c[1])))):
                        for x in range(max(0,math.floor(min(a[0],b[0],c[0]))),min(SIZE,math.ceil(max(a[0],b[0],c[0])))):
                            pixel = y*SIZE+x
                            if pixel in covered:
                                continue
                            wa = ((b[1]-c[1])*(x+.5-c[0])+(c[0]-b[0])*(y+.5-c[1]))/denom
                            wb = ((c[1]-a[1])*(x+.5-c[0])+(a[0]-c[0])*(y+.5-c[1]))/denom
                            weights = (wa,wb,1-wa-wb)
                            if min(weights) < -1e-7:
                                continue
                            covered.add(pixel)
                            u,v = [sum(weights[j]*uvs[indices[j]][axis] for j in range(3))/16 for axis in (0,1)]
                            rgba = texels[min(texture.width-1,max(0,int(u*texture.width))),min(texture.height-1,max(0,int(v*texture.height)))]
                            if rgba[3] == 0:
                                continue
                            depth = sum(weights[j]*points[indices[j]][2] for j in range(3))
                            color = tuple(round(rgba[i]*tint[i]/255*shade) for i in range(3))+(rgba[3],)
                            fragments[pixel].append((round(depth, 7),face_id,color))
        image = Image.new('RGBA',(SIZE,SIZE))
        result = []
        for layers in fragments:
            rgb, alpha = [0.,0.,0.], 0.
            for _, _, color in sorted(layers):
                a = color[3]/255
                rgb = [color[i]*a + rgb[i]*(1-a) for i in range(3)]
                alpha = a + alpha*(1-a)
            result.append(tuple(round(channel/alpha) for channel in rgb)+(round(alpha*255),) if alpha else (0,0,0,0))
        image.putdata(result)
        if not image.getbbox():
            raise ValueError('Empty render')
        return image


def item_model(node):
    kind = node.get('type', '').split(':')[-1]
    if kind == 'model':
        return node
    if kind in ('select','range_dispatch') and 'fallback' in node:
        return item_model(node['fallback'])
    if kind == 'condition':
        return item_model(node['on_false'])
    return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pack', type=Path)
    parser.add_argument('--version', required=True)
    args = parser.parse_args()
    renderer = Renderer(args.pack.resolve())
    base = args.pack / 'assets' / 'minecraft'
    ru_file = base/'lang'/'ru_ru.json'
    localization = json.loads((ROOT/'scripts'/'data'/'minecraft-block-names-ru.json').read_text(encoding='utf-8'))
    ru = json.loads(ru_file.read_text(encoding='utf-8')) if ru_file.exists() else localization['names']
    en = json.loads((base/'lang'/'en_us.json').read_text(encoding='utf-8'))
    output = ROOT/'www'/'assets'/'blocks_minecraft'
    output.mkdir(parents=True,exist_ok=True)
    items, skipped = [], []
    for file in sorted((base/'items').glob('*.json')):
        name = file.stem
        if not (base/'blockstates'/f'{name}.json').exists():
            continue
        try:
            model = item_model(json.loads(file.read_text(encoding='utf-8'))['model'])
            if not model:
                raise ValueError('Special/entity renderer')
            image = renderer.render(model['model'], model.get('tints', []))
            image.save(output/f'{name}.png',optimize=True)
            key = f'block.minecraft.{name}'
            items.append({'id':f'block_render:{name}','minecraftId':name,'file':f'{name}.png','folder':'blocks_minecraft','name':ru.get(key,en.get(key,name)), 'en':en.get(key,name),'category':'block_renders'})
        except (ValueError, KeyError, FileNotFoundError, IndexError) as error:
            skipped.append({'id':name,'reason':'Unresolved texture reference in source model' if isinstance(error, FileNotFoundError) else str(error)})
    catalog = ROOT/'www'/'js'/'utils'/'MinecraftBlocks.js'
    catalog.write_text('// Generated from the user-provided vanilla resource pack. See assets/blocks_minecraft/manifest.json.\nexport const MINECRAFT_BLOCKS = '+json.dumps(items,ensure_ascii=False,indent=2)+';\n',encoding='utf-8')
    manifest = {'source':'User-provided vanilla Minecraft resource pack','versionLabel':args.version,'versionVerified':False,'copyright':'Minecraft textures and models © Mojang AB / Microsoft. Not covered by the application code license.','renderer':'scripts/generate-minecraft-resources.py','renderSize':SIZE,'animation':'First defined frame','limitations':['Entity/special item renderers are excluded','Static GUI lighting approximation; no game shaders or ambient occlusion'],'rendered':len(items),'skipped':skipped,'sourceHashes':renderer.sources}
    manifest['localization'] = localization['source']
    (output/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    samples = ['grass_block','stone','oak_log','oak_stairs','oak_slab','oak_fence','glass','oak_leaves','crafting_table','furnace','diamond_ore','amethyst_block']
    sheet = Image.new('RGB',(480,360),'#23262d')
    draw = ImageDraw.Draw(sheet)
    for index,name in enumerate(samples):
        file = output/f'{name}.png'
        if not file.exists():
            continue
        x,y = index%4*120,index//4*120
        sheet.paste(Image.open(file),(x+28,y+8),Image.open(file))
        draw.text((x+5,y+82),name,fill='white')
    (ROOT/'.test-output').mkdir(exist_ok=True)
    sheet.save(ROOT/'.test-output'/'minecraft-blocks.png')
    print(json.dumps({'rendered':len(items),'skipped':len(skipped),'folder':str(output)}))


if __name__ == '__main__':
    main()
