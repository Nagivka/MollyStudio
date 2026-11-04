"""Synchronize usable flat sprites, preserving published IDs and legacy assets.

Usage: python scripts/sync-minecraft-sprites.py "path/to/vanilla/pack"
Perspective block models are handled by generate-minecraft-resources.py.
"""
import argparse
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pack', type=Path)
    args = parser.parse_args()
    base = args.pack / 'assets/minecraft'
    version = json.loads((args.pack / 'version.json').read_text(encoding='utf-8'))
    english = json.loads((base / 'lang/en_us.json').read_text(encoding='utf-8'))
    catalog = ROOT / 'src/renderer/js/utils/MinecraftItems.js'
    source = catalog.read_text(encoding='utf-8')
    marker = 'export const MINECRAFT_ITEMS = '
    head, raw = source.split(marker, 1)
    items, end = json.JSONDecoder().raw_decode(raw)
    identities = {item['id'] for item in items}
    report = dict(sourceVersion=version['id'], sourceStable=version['stable'], added=[], updated=[])
    color_names = dict(zip(
        'white orange magenta light_blue yellow lime pink gray light_gray cyan purple blue brown green red black'.split(),
        ['Белая', 'Оранжевая', 'Пурпурная', 'Голубая', 'Жёлтая', 'Лаймовая', 'Розовая', 'Серая', 'Светло-серая', 'Бирюзовая', 'Фиолетовая', 'Синяя', 'Коричневая', 'Зелёная', 'Красная', 'Чёрная']))

    def copy_sprite(file, folder):
        destination = ROOT / 'src/renderer/assets' / folder / file.name
        image = Image.open(file).convert('RGBA')
        if destination.exists():
            with Image.open(destination) as old:
                if old.size == image.size and old.convert('RGBA').tobytes() == image.tobytes():
                    return
            report['updated'].append(folder + '/' + file.name)
        else:
            report['added'].append(folder + '/' + file.name)
        image.save(destination, optimize=True)

    # Refresh existing sprites without replacing derived clock/compass aliases.
    for folder, texture_folder in [('items_minecraft', 'item'), ('mob_effect', 'mob_effect'), ('painting', 'painting')]:
        for item in (item for item in items if item['folder'] == folder):
            file = base / 'textures' / texture_folder / item['file']
            if file.exists():
                copy_sprite(file, folder)

    # Only complete single-layer flat item models belong in the item library.
    # Animation frames, overlays and in-hand textures are not separate items.
    for definition in sorted((base / 'items').glob('*.json')):
        name = definition.stem
        if name in identities:
            continue
        node = json.loads(definition.read_text(encoding='utf-8')).get('model', {})
        model_id = node.get('model', '')
        if node.get('type') != 'minecraft:model' or not model_id.startswith('minecraft:item/'):
            continue
        model_file = base / 'models' / (model_id.removeprefix('minecraft:') + '.json')
        if not model_file.exists():
            continue
        model = json.loads(model_file.read_text(encoding='utf-8'))
        if model.get('parent') not in ('item/generated', 'minecraft:item/generated') or model.get('textures') != {'layer0': 'minecraft:item/' + name}:
            continue
        file = base / 'textures/item' / (name + '.png')
        if not file.exists():
            continue
        copy_sprite(file, 'items_minecraft')
        label = english.get('item.minecraft.' + name, english.get('block.minecraft.' + name, name.replace('_', ' ').title()))
        russian = color_names.get(name.removesuffix('_cushion'), '') + ' подушка' if name.endswith('_cushion') else label
        items.append(dict(id=name, file=file.name, folder='items_minecraft', name=russian, en=label, category='blocks' if (base / 'blockstates' / definition.name).exists() else 'materials'))
        identities.add(name)

    for file in sorted((base / 'textures/mob_effect').glob('*.png')):
        identity = 'effect_' + file.stem
        if identity in identities:
            continue
        copy_sprite(file, 'mob_effect')
        label = english.get('effect.minecraft.' + file.stem, file.stem.replace('_', ' ').title())
        items.append(dict(id=identity, file=file.name, folder='mob_effect', name='Эффект: Замерзание' if file.stem == 'freezing' else 'Эффект: ' + label, en=label + ' Effect', category='effects'))
        identities.add(identity)

    catalog.write_text(head + marker + json.dumps(items, ensure_ascii=False, indent=4) + raw[end:], encoding='utf-8')
    output = ROOT / '.test-output/minecraft-sprite-sync.json'
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()
