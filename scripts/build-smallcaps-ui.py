import json, sys
sys.path.insert(0, sys.argv[3])
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

data=json.load(open(sys.argv[1],encoding='utf-8'))
builder=FontBuilder(800,isTTF=True)
order=['.notdef']+['u%04X'%ord(char) for char in data]
builder.setupGlyphOrder(order)
glyphs={'.notdef':TTGlyphPen(None).glyph()}
metrics={'.notdef':(600,0)}
for char,record in data.items():
    name='u%04X'%ord(char);pen=TTGlyphPen(None);pixels=record['pixels']
    left=min((p[0] for p in pixels),default=0)
    right=max((p[0] for p in pixels),default=2)
    for x,y in pixels:
        x=(x-left)*100;y=600-y*100
        pen.moveTo((x,y));pen.lineTo((x+100,y));pen.lineTo((x+100,y+100));pen.lineTo((x,y+100));pen.closePath()
    glyphs[name]=pen.glyph();metrics[name]=((right-left+2)*100,0)
builder.setupCharacterMap({ord(char):'u%04X'%ord(char) for char in data})
builder.setupGlyf(glyphs);builder.setupHorizontalMetrics(metrics)
builder.setupHorizontalHeader(ascent=800,descent=-200)
family=sys.argv[4] if len(sys.argv)>4 else 'Molly SmallCaps UI'
builder.setupNameTable({'familyName':family,'styleName':'Regular','uniqueFontIdentifier':family.replace(' ',''),'fullName':family,'psName':family.replace(' ','')})
builder.setupOS2(sTypoAscender=800,sTypoDescender=-200,usWinAscent=800,usWinDescent=200)
builder.setupPost();builder.font.flavor='woff2';builder.save(sys.argv[2])
print('Generated UI font with',len(data),'mapped characters')
