"""Restore the complete title font catalog at the pinned commit, checking every hash.

This is a developer-only network operation; application builds use local assets.
Original authors and artwork terms remain in assets/title_generator/NOTICE.md.
"""
import hashlib
import json
import argparse
from collections import Counter
from io import BytesIO
from pathlib import Path
from urllib.request import urlopen
from PIL import Image

ROOT=Path(__file__).resolve().parent.parent
ARTWORK=ROOT/'src/renderer/assets/title_generator'


def rectangles(cells):
    """Merge matching horizontal runs vertically. Coordinates stay on source texel edges."""
    pending={}
    for y in range(min((p[1] for p in cells),default=0),max((p[1] for p in cells),default=-1)+2):
        row=sorted(x for x,cy in cells if cy==y)
        runs=[]
        for x in row:
            value=cells[x,y]
            if runs and runs[-1][1]==x and runs[-1][2]==value:runs[-1][1]+=1
            else:runs.append([x,x+1,value])
        current={}
        for x0,x1,value in runs:
            key=(x0,x1,value)
            current[key]=pending.pop(key,[x0,y,x1,y,value]);current[key][3]=y+1
        yield from pending.values()
        pending=current


def boundary(cells):
    """Only exposed contour edges; no internal walls or inverted bounding boxes."""
    runs={}
    for x,y in cells:
        for dx,dy,axis,coordinate,start in [(-1,0,'west',x,y),(1,0,'east',x+1,y),(0,-1,'down',y,x),(0,1,'up',y+1,x)]:
            if (x+dx,y+dy) not in cells:runs.setdefault((axis,coordinate),[]).append(start)
    result=[]
    for (axis,coordinate),values in sorted(runs.items()):
        start=previous=min(values)
        for value in sorted(values)[1:]+[max(values)+2]:
            if value!=previous+1:
                result.append([axis,coordinate,start,previous+1]);start=value
            previous=value
    return result


def conform(rects,edges):
    """Split adjoining cap and wall edges at the same coordinates (no T-junctions)."""
    xs=sorted({r[i] for r in rects for i in (0,2)})
    ys=sorted({r[i] for r in rects for i in (1,3)})
    caps=[]
    for x0,y0,x1,y1,index in rects:
        xcuts=[x for x in xs if x0<=x<=x1];ycuts=[y for y in ys if y0<=y<=y1]
        caps.extend([a,b,c,d,index] for a,c in zip(xcuts,xcuts[1:]) for b,d in zip(ycuts,ycuts[1:]))
    walls=[]
    for side,coordinate,start,end in edges:
        cuts=[v for v in (xs if side in ('up','down') else ys) if start<=v<=end]
        walls.extend([side,coordinate,a,b] for a,b in zip(cuts,cuts[1:]))
    return caps,walls


def compile_profile(elements,image):
    """Turn the source front silhouettes into closed, outward-facing solids.

    The reference's transparent sheets and inside-out helper boxes are suitable
    for its fixed camera, but expose black rectangular walls at other angles.
    Preserve its artwork/UVs while replacing those helpers with actual contours.
    No image processing or triangulation runs in the application.
    """
    width,height=image.size
    def pixel(uv):return image.getpixel((min(width-1,max(0,int(uv[0]*width/16))),min(height-1,max(0,int(uv[1]*height/16)))))
    def uv_at(cube,side,x,y):
        u0,v0,u1,v1=cube['faces'][side]
        return [u0+(u1-u0)*(cube['to'][0]-x)/(cube['to'][0]-cube['from'][0]),v0+(v1-v0)*(cube['to'][1]-y)/(cube['to'][1]-cube['from'][1])]
    # Front/back sheets with meaningful texture areas are the real letter parts.
    candidates=[]
    for index,cube in enumerate(elements):
        uv=cube['faces'].get('north')
        if uv and cube['from'][0]<cube['to'][0] and cube['from'][1]<cube['to'][1] and abs(uv[2]-uv[0])*width/16>=2 and abs(uv[3]-uv[1])*height/16>=2:
            candidates.append((index,cube))
    if not candidates:return None
    cells={}
    # The frontmost source surface owns overlapping artwork, never a hidden plane.
    for index,cube in sorted(candidates,key=lambda item:item[1]['from'][2],reverse=True):
        for y in range(round(cube['from'][1]),round(cube['to'][1])):
            for x in range(round(cube['from'][0]),round(cube['to'][0])):
                if pixel(uv_at(cube,'north',x+.5,y+.5))[3]>=128:cells[x,y]=index
    if not cells:return None
    rects,edges=conform(list(rectangles(cells)),boundary(cells))
    caps=[]
    for x0,y0,x1,y1,index in rects:
        cube=elements[index]
        north=[round(n,6) for n in uv_at(cube,'north',x1,y1)+uv_at(cube,'north',x0,y0)]
        # Source south UVs are mirrored horizontally, with the same Y convention.
        south=[round(n,6) for n in uv_at(cube,'south',x0,y1)+uv_at(cube,'south',x1,y0)] if 'south' in cube['faces'] else [north[2],north[1],north[0],north[3]]
        caps.append([x0,y0,x1,y1,north,south])
    ring={(x+dx,y+dy):0 for x,y in cells for dx in range(-2,3) for dy in range(-2,3) if (x+dx,y+dy) not in cells}
    # Pick texel CENTERS in the reference's flat atlas. Corresponding atlases use
    # identical layouts; constant UVs must not sample neighbouring transparent cells.
    primary=candidates[0][1]
    def sample(side,fallback):
        if side not in primary['faces']:return fallback
        u0,v0,u1,v1=primary['faces'][side]
        area=[]
        for y in range(round(min(v0,v1)*height/16),round(max(v0,v1)*height/16)):
            for x in range(round(min(u0,u1)*width/16),round(max(u0,u1)*width/16)):
                if 0<=x<width and 0<=y<height and image.getpixel((x,y))[3]>=128:area.append((x,y,image.getpixel((x,y))))
        if not area:return fallback
        common=Counter(p[2] for p in area).most_common(1)[0][0]
        x,y,_=next(p for p in area if p[2]==common)
        return [(x+.5)*16/width,(y+.5)*16/height]
    dark=None
    # The black border strip can start above the final row, and some atlases use
    # transparency there; find a genuinely opaque black texel instead.
    for y in range(height-1,-1,-1):
        found=next((x for x in range(width) if (p:=image.getpixel((x,y)))[3]>=128 and max(p[:3])<32),None)
        if found is not None:dark=[(found+.5)*16/width,(y+.5)*16/height];break
    ring_rects,ring_edges=conform(list(rectangles(ring)),boundary(ring))
    return {'caps':caps,'edges':edges,'ring':[r[:4] for r in ring_rects],'ringEdges':ring_edges,
            'lightUV':sample('up',None),'sideUV':sample('down',None),'borderUV':dark,
            'bodyIndex':candidates[0][0],'borderIndex':next((i for i,c in enumerate(elements) if all(a>b for a,b in zip(c['from'],c['to']))),len(elements)),
            'bounds':[min(x for x,y in cells)-2,min(y for x,y in cells)-2,max(x for x,y in cells)+3,max(y for x,y in cells)+3]}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir',type=Path,help='Use a previously downloaded source tree; every SHA256 is still checked.')
    args=parser.parse_args()
    manifest=json.loads((ARTWORK/'manifest.json').read_text(encoding='utf-8'))
    base='https://raw.githubusercontent.com/ewanhowell5195/MinecraftTitleGenerator/'+manifest['commit']+'/'
    models={};atlases={}
    for path,digest in manifest['sourceHashes'].items():
        parts=path.split('/')
        if path not in ('fonts.json','tileables.json') and not (len(parts)>=3 and parts[0]=='fonts' and parts[1] in manifest['authors']) and path not in manifest.get('assetPaths',{}):
            raise ValueError('Unexpected asset path: '+path)
        if args.source_dir:data=(args.source_dir/path).read_bytes()
        else:
            with urlopen(base+path,timeout=30) as response:data=response.read()
        if hashlib.sha256(data).hexdigest()!=digest:
            raise ValueError('Source checksum mismatch: '+path)
        if path.endswith('/characters.json'):
            models[parts[1]]=dict(characters=json.loads(data),author=manifest['authors'][parts[1]])
        elif path in manifest.get('assetPaths',{}):
            destination=ARTWORK/manifest['assetPaths'][path]
            if not destination.resolve().is_relative_to(ARTWORK.resolve()):raise ValueError('Unexpected asset destination: '+path)
            destination.parent.mkdir(parents=True,exist_ok=True);destination.write_bytes(data)
            if len(parts)==4 and parts[2]=='textures' and parts[3]=='flat.png':atlases[parts[1]]=Image.open(BytesIO(data)).convert('RGBA')
        elif path in ('fonts.json','tileables.json') or path.endswith('/textures.json'):continue
        else:
            raise ValueError('Unexpected asset type: '+path)
    for font,model in models.items():
        model['profiles']={char:profile for char,elements in model['characters'].items() if (profile:=compile_profile(elements,atlases[font]))}
    # Owned, opaque fallback swatches for fonts whose reference atlas contains
    # only front faces. They must still have visible, closed extrusion walls.
    swatches=Image.new('RGBA',(3,1));swatches.putdata([(176,176,176,255),(84,84,84,255),(0,0,0,255)])
    swatches.save(ARTWORK/'contour-swatches.png',optimize=True)
    header='// Minecraft Title Generator artwork and compiled closed profiles. Provenance: assets/title_generator/NOTICE.md\n'
    catalog=ROOT/'src/renderer/js/utils/TitleFontModels.js'
    catalog.write_text(header+'export const TITLE_FONT_MODELS = '+json.dumps(models,ensure_ascii=False,separators=(',',':'))+';\n',encoding='utf-8')
    (ROOT/'src/renderer/js/core/TitleFontCatalog.mjs').write_text('// Generated by scripts/vendor-title-assets.py from the pinned source catalog.\nexport const TITLE_FONT_CATALOG = Object.freeze('+json.dumps(manifest['fonts'],ensure_ascii=False,separators=(',',':'))+');\n',encoding='utf-8')
    (ROOT/'src/renderer/js/core/TitleMaterialCatalog.mjs').write_text('// Original Minecraft Title Generator artwork. See assets/title_generator/NOTICE.md\nexport const TITLE_MATERIAL_CATALOG = '+json.dumps(manifest['materialCatalog'],ensure_ascii=False,separators=(',',':'))+';\n',encoding='utf-8')
    print(json.dumps(dict(commit=manifest['commit'],fonts=len(models),verified=len(manifest['sourceHashes']))))


if __name__=='__main__':
    main()
