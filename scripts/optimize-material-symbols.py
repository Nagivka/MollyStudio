"""Rebuild the UI icon font without changing outlines, weights or filled states.

Install scripts/requirements-font-tools.txt into a development environment.
The full source font stays outside the distributed renderer, so additions are
recoverable. Source-token discovery deliberately retains extra matching symbols
to cover dynamic icon choices as well as literal HTML labels.
"""
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--python-path', type=Path, help='Optional local dependency folder')
parser.add_argument('--output', type=Path, default=ROOT / 'src/renderer/assets/fonts/MaterialSymbolsRounded.woff2')
parser.add_argument('--manifest', type=Path, default=ROOT / 'scripts/data/material-symbols.json')
args = parser.parse_args()
if args.python_path:
    sys.path.insert(0, str(args.python_path.resolve()))
from fontTools import subset
from fontTools.ttLib import TTFont

source = ROOT / 'design/font-sources/MaterialSymbolsRounded.woff2'
font = TTFont(source, recalcTimestamp=False)
cmap = font.getBestCmap()
ascii_names = {glyph: chr(code) for code, glyph in cmap.items() if 32 <= code < 127}
ligatures = {}
substitutions = {}
for lookup in font['GSUB'].table.LookupList.Lookup:
    for wrapped in lookup.SubTable:
        table = getattr(wrapped, 'ExtSubTable', wrapped)
        for first, values in getattr(table, 'ligatures', {}).items():
            for ligature in values:
                inputs = [first, *ligature.Component]
                if all(glyph in ascii_names for glyph in inputs):
                    name = ''.join(ascii_names[glyph] for glyph in inputs)
                    ligatures[name] = ligature.LigGlyph
        substitutions.update(getattr(table, 'mapping', {}))

tokens = set()
codepoints = set()
for file in sorted((ROOT / 'src/renderer').rglob('*')):
    if file.suffix not in {'.js', '.mjs', '.html', '.css', '.json'}:
        continue
    text = file.read_text(encoding='utf-8')
    tokens.update(re.findall(r'[a-z][a-z_0-9]*', text))
    codepoints.update(ord(char) for char in text if ord(char) >= 0xE000 and ord(char) in cmap)
    for match in re.finditer(r'\\(?:u\{([0-9a-fA-F]{4,6})\}|u([0-9a-fA-F]{4})|([0-9a-fA-F]{4,6})(?![0-9a-fA-F]))', text):
        codepoints.add(int(next(value for value in match.groups() if value), 16))

names = sorted(tokens & ligatures.keys())
(source.parent / 'material-symbols-ligatures.json').write_text(json.dumps(sorted(ligatures), indent=2) + '\n', encoding='utf-8')
glyphs = {cmap[code] for code in range(32, 127) if code in cmap}
glyphs.update(cmap[code] for code in codepoints if code in cmap)
glyphs.update(ligatures[name] for name in names)
# Filled symbols are feature variations, not additional text ligatures.
while True:
    added = {substitutions[glyph] for glyph in glyphs if glyph in substitutions} - glyphs
    if not added:
        break
    glyphs.update(added)

options = subset.Options()
options.layout_closure = False
options.name_IDs = ['*']
subsetter = subset.Subsetter(options)
subsetter.populate(glyphs=glyphs)
subsetter.subset(font)
args.output.parent.mkdir(parents=True, exist_ok=True)
font.save(args.output)
report = {
    'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
    'fontSha256': hashlib.sha256(args.output.read_bytes()).hexdigest(),
    'sourceBytes': source.stat().st_size,
    'bytes': args.output.stat().st_size,
    'glyphs': len(font.getGlyphOrder()),
    'names': names,
    'axes': [[axis.axisTag, axis.minValue, axis.defaultValue, axis.maxValue] for axis in font['fvar'].axes],
}
manifest = args.manifest
manifest.parent.mkdir(parents=True, exist_ok=True)
manifest.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
print(json.dumps({key: value for key, value in report.items() if key != 'names'}))
print(f'Retained {len(names)} icon ligatures. Manifest: {manifest}')
