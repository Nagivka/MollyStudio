"""Lossless PNG recompression; keep only candidates with identical decoded RGBA pixels."""
from io import BytesIO
from pathlib import Path
import hashlib
import json
import re
import struct
import zlib
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent


def deduplicate_block_renders():
    """Keep catalog identities while sharing byte-identical generated PNG files."""
    directory = (ROOT / 'src/renderer/assets/blocks_minecraft').resolve()
    catalog = ROOT / 'src/renderer/js/utils/MinecraftBlocks.js'
    source = catalog.read_text(encoding='utf-8')
    header, raw = source.split('export const MINECRAFT_BLOCKS = ', 1)
    items = json.loads(raw.strip().removesuffix(';'))
    groups, aliases = {}, {}
    for item in items:
        name = item['file']
        if not re.fullmatch(r'[a-z0-9_]+\.png', name):
            raise ValueError('Unexpected block render filename')
        path = (directory / name).resolve()
        if path.parent != directory:
            raise ValueError('Block render is outside its asset directory')
        data = path.read_bytes()
        groups.setdefault(hashlib.sha256(data).digest(), set()).add(name)
    for files in groups.values():
        canonical = min(files, key=lambda name: (name.startswith(('waxed_', 'infested_')), len(name), name))
        for name in files - {canonical}:
            # Verify the bytes themselves before removing a file.
            if (directory / name).read_bytes() != (directory / canonical).read_bytes():
                raise ValueError('Block render hash collision')
            aliases[name] = canonical
    if not aliases:
        return dict(removedFiles=0, savedBytes=0, entries=len(items))
    for item in items:
        item['file'] = aliases.get(item['file'], item['file'])
    manifest_file = directory / 'manifest.json'
    manifest = json.loads(manifest_file.read_text(encoding='utf-8'))
    manifest['renderFiles'] = len({item['file'] for item in items})
    manifest['sharedRenderEntries'] = len(items) - manifest['renderFiles']
    # Persist all references before deleting their redundant files.
    catalog.write_text(header + 'export const MINECRAFT_BLOCKS = ' + json.dumps(items, ensure_ascii=False, indent=2) + ';\n', encoding='utf-8')
    manifest_file.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    saved = sum((directory / name).stat().st_size for name in aliases)
    for name in aliases:
        (directory / name).unlink()
    return dict(removedFiles=len(aliases), savedBytes=saved, entries=len(items))


def optimize_pngs():
    before = after = changed = checked = 0
    for path in sorted((ROOT / "src/renderer/assets").rglob("*.png")):
        data = path.read_bytes()
        before += len(data)
        with Image.open(BytesIO(data)) as image:
            if getattr(image, "n_frames", 1) != 1:
                after += len(data)
                continue
            pixels = image.convert("RGBA").tobytes()
            # Preserve every color-profile and ancillary chunk, not just decoded pixels.
            chunks, offset = [], 8
            while offset + 12 <= len(data):
                length = int.from_bytes(data[offset:offset+4], "big")
                chunks.append((data[offset+4:offset+8], data[offset:offset+length+12]))
                offset += length + 12
            packed = b"".join(chunk[8:-4] for kind, chunk in chunks if kind == b"IDAT")
            compressed = zlib.compress(zlib.decompress(packed), 9)
            idat = struct.pack(">I", len(compressed)) + b"IDAT" + compressed + struct.pack(">I", zlib.crc32(b"IDAT" + compressed))
            output, written = [data[:8]], False
            for kind, chunk in chunks:
                if kind == b"IDAT":
                    if not written:
                        output.append(idat)
                        written = True
                else:
                    output.append(chunk)
            candidate = b"".join(output)
            with Image.open(BytesIO(candidate)) as decoded:
                if decoded.size != image.size or decoded.convert("RGBA").tobytes() != pixels:
                    raise ValueError(f"PNG pixels changed: {path}")
            checked += 1
            if len(candidate) < len(data):
                path.write_bytes(candidate)
                data = candidate
                changed += 1
            after += len(data)
    return dict(checked=checked, changed=changed, before=before, after=after, saved=before-after)


if __name__ == "__main__":
    report = optimize_pngs()
    report['blockDeduplication'] = deduplicate_block_renders()
    output = ROOT / ".test-output"
    output.mkdir(exist_ok=True)
    (output / "asset-optimization.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report))
