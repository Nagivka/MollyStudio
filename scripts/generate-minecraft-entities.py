"""Bake Java entity models into transparent pixel-art resources, entirely offline.

Needs a developer JDK matching the source pack, Pillow, and the launcher's Java
libraries. End users only receive PNG files; Java and game code are not bundled.
"""
import argparse
import hashlib
import json
import math
import os
import shutil
import subprocess
from functools import lru_cache
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SIZE = 96


def view(point):
    x, y, z = point
    angle = math.radians(225)
    x, z = x*math.cos(angle)+z*math.sin(angle), -x*math.sin(angle)+z*math.cos(angle)
    angle = math.radians(15)
    return x, y*math.cos(angle)-z*math.sin(angle), y*math.sin(angle)+z*math.cos(angle)


def render(layers, textures):
    points = [view(vertex[:3]) for layer in layers for face in layer['faces'] for vertex in face['vertices']]
    minimum = [min(p[i] for p in points) for i in (0, 1)]
    maximum = [max(p[i] for p in points) for i in (0, 1)]
    scale = (SIZE-12)/max(maximum[i]-minimum[i] for i in (0, 1))
    center = [(minimum[i]+maximum[i])/2 for i in (0, 1)]
    fragments = [[] for _ in range(SIZE*SIZE)]
    for layer_index, layer in enumerate(layers):
        texture = textures(layer['texture'])
        texels = texture.load()
        for face_index, face in enumerate(layer['faces']):
            if view(face['normal'])[2] <= 1e-7:
                continue
            normal = face['normal']
            shade = 1 if layer['emissive'] else min(1, .64+.30*max(0,normal[1])+.16*max(0,-normal[2]))
            vertices = []
            for vertex in face['vertices']:
                x,y,z = view(vertex[:3])
                vertices.append((SIZE/2+(x-center[0])*scale,SIZE/2-(y-center[1])*scale,z,*vertex[3:]))
            covered = set()
            for indices in ((0,1,2),(0,2,3)):
                a,b,c = [vertices[i] for i in indices]
                denominator = (b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
                if abs(denominator) < 1e-9:
                    continue
                for y in range(max(0,math.floor(min(a[1],b[1],c[1]))), min(SIZE,math.ceil(max(a[1],b[1],c[1])))):
                    for x in range(max(0,math.floor(min(a[0],b[0],c[0]))), min(SIZE,math.ceil(max(a[0],b[0],c[0])))):
                        index = y*SIZE+x
                        if index in covered:
                            continue
                        wa = ((b[1]-c[1])*(x+.5-c[0])+(c[0]-b[0])*(y+.5-c[1]))/denominator
                        wb = ((c[1]-a[1])*(x+.5-c[0])+(a[0]-c[0])*(y+.5-c[1]))/denominator
                        weights = (wa,wb,1-wa-wb)
                        if min(weights) < -1e-7:
                            continue
                        covered.add(index)
                        u,v = [sum(weights[j]*vertices[indices[j]][axis] for j in range(3)) for axis in (3,4)]
                        pixel = texels[min(texture.width-1,max(0,int(u*texture.width))), min(texture.height-1,max(0,int(v*texture.height)))]
                        alpha = round(pixel[3]*layer['opacity'])
                        if not alpha:
                            continue
                        depth = sum(weights[j]*vertices[indices[j]][2] for j in range(3))
                        color = tuple(round(value*shade) for value in pixel[:3])+(alpha,)
                        fragments[index].append((round(depth,6),layer_index,face_index,color))
    pixels = []
    for fragments_at_pixel in fragments:
        rgb,alpha = [0.,0.,0.],0.
        for *_,color in sorted(fragments_at_pixel):
            a = color[3]/255
            rgb = [color[i]*a+rgb[i]*(1-a) for i in range(3)]
            alpha = a+alpha*(1-a)
        pixels.append(tuple(round(channel/alpha) for channel in rgb)+(round(alpha*255),) if alpha else (0,0,0,0))
    image = Image.new('RGBA',(SIZE,SIZE));image.putdata(pixels)
    if not image.getbbox():
        raise ValueError('Entity rendered empty')
    return image


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pack',type=Path)
    parser.add_argument('--java',default=shutil.which('java'))
    parser.add_argument('--libraries',type=Path,required=True)
    args = parser.parse_args()
    pack = args.pack.resolve()
    version = json.loads((pack/'version.json').read_text(encoding='utf-8'))
    definitions = ROOT/'scripts/data/minecraft-entity-models.json'
    specs = json.loads(definitions.read_text(encoding='utf-8'))
    meshes = ROOT/'.test-output/entity-models/meshes';meshes.mkdir(parents=True,exist_ok=True)
    libraries = [str(p) for p in sorted(args.libraries.rglob('*.jar'),reverse=True) if 'natives-' not in p.name]
    classpath = os.pathsep.join([str(pack),*libraries])
    subprocess.run([args.java,'-cp',classpath,str(ROOT/'scripts/ExportMinecraftEntities.java'),str(definitions),str(meshes)],check=True,cwd=meshes)
    output = ROOT/'src/renderer/assets/entities_minecraft';output.mkdir(exist_ok=True)
    hashes = {}

    @lru_cache(maxsize=128)
    def texture(name):
        if any(part in ('..','') for part in name.split('/')):
            raise ValueError('Unsafe texture path')
        relative = 'assets/minecraft/textures/entity/'+name+'.png'
        file = pack/relative
        hashes[relative] = hashlib.sha256(file.read_bytes()).hexdigest()
        with Image.open(file) as source:
            return source.convert('RGBA')

    catalog = []
    sheet = Image.new('RGB',(600,math.ceil(len(specs)/5)*122),'#24262d');draw = ImageDraw.Draw(sheet)
    for index,spec in enumerate(specs):
        layers = json.loads((meshes/(spec['id']+'.json')).read_text(encoding='utf-8'))
        image = render(layers,texture)
        image.save(output/(spec['id']+'.png'),optimize=True)
        catalog.append(dict(id='entity_render:'+spec['id'],minecraftId=spec['id'],file=spec['id']+'.png',folder='entities_minecraft',name=spec['name'],en=spec['en'],category='entity_renders'))
        x,y = (index%5)*120,(index//5)*122
        sheet.paste(image,(x+12,y),image);draw.text((x+4,y+100),spec['id'],fill='white')
    sheet.save(ROOT/'.test-output/minecraft-entities.png')
    model_classes = {layer['model'].replace('.', '/')+'.class' for spec in specs for layer in spec['layers']}
    model_classes.update(['geom/ModelPart.class', 'geom/ModelPart$Cube.class', 'geom/ModelPart$Polygon.class', 'geom/ModelPart$Vertex.class'])
    model_hashes = {}
    for name in sorted(model_classes):
        relative = 'net/minecraft/client/model/'+name
        model_hashes[relative] = hashlib.sha256((pack/relative).read_bytes()).hexdigest()
    manifest = dict(source='User-provided vanilla Minecraft client',sourceVersion=version['id'],sourceStable=version['stable'],renderSize=SIZE,rendered=len(catalog),geometry='Baked Java ModelPart meshes with original UV coordinates and hierarchy',pose='Neutral model pose',limitations=['Static orthographic three-quarter view; no game shaders, shadows or animation'],sourceHashes=hashes,modelSourceHashes=model_hashes,copyright='Minecraft textures and models © Mojang AB / Microsoft. Not covered by the application code license.')
    (output/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    (ROOT/'src/renderer/js/utils/MinecraftEntities.js').write_text('// Generated by scripts/generate-minecraft-entities.py.\nexport const MINECRAFT_ENTITIES = '+json.dumps(catalog,ensure_ascii=False,indent=2)+';\n',encoding='utf-8')
    print(json.dumps(dict(rendered=len(catalog),size=SIZE)))


if __name__ == '__main__':
    main()
