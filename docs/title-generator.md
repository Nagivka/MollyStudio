# 3D title projects

Create a **Генератор надписей** project from the launcher or the editor's
new-project dialog. The workspace mounts a live WebGL scene. Left-click selects
a letter; Ctrl+click selects one model part. Dragging a letter body only selects
it. Transform models using the X/Y/Z arrows (the arm and tip both accept a drag),
or enter position, rotation and scale in the Scene inspector. Shift snaps a
gesture; Ctrl while dragging a scale handle scales all axes proportionally.
Escape cancels a gesture, retaining the selection. Right-drag on a gizmo navigates
the camera and does not transform the model.
Right-drag orbits, Shift+right-drag pans, and the wheel zooms. W/E/R switch
between move/rotate/scale; F resets the editing camera.

The outliner retains a row → letter → cuboid hierarchy with visibility and lock
controls. Changes affect individual models, support undo/redo, and are stored
in MLST. A parent's transform is inherited by its children. Picking ray-tests
the visible mesh triangles and the texture alpha, including transparent holes between closed contour walls.
The scene tree supports arrow keys and Home/End, retains focus after actions,
and scrolls a keyboard-selected object into view. Initial resource loading
temporarily disables dependent controls and never exposes an uninitialized document.

Edit, Render and PNG export share one camera pose: yaw, pitch, zoom and pan target.
Camera controls and viewport navigation update the same document values, including
fractional angles. Navigation commits one history entry per gesture; wheel events
are grouped and flushed immediately before saving or exporting. Camera undo also
restores the viewport. No manual camera-copy button is needed.

The eye distance depends on the untransformed scene bounds, not the PNG aspect,
resolution, window size or manual glyph transforms. The output uses an off-axis
frustum to crop the same projected image. It never moves the eye toward a wide
word to make it fit: that would flare its edges and squash its center. Both
projections retain the same geometry proportions in portrait, landscape and square
outputs. Render mode displays the output frame, letterboxed in the window.

A raster layer is retained for thumbnail/recovery compatibility, not as the
interactive scene. A separate offscreen WebGL renderer handles PNG output, leaving
the visible framebuffer and picking coordinates untouched. Scaled PNG exports
render at native resolution instead of enlarging a cached bitmap. Scene rendering
runs on demand, without an idle animation loop.

The precision suite saves real files and compares their alpha silhouettes with
the Editing view, including the complete MINECRAFT word and a multiline Cyrillic
title. It also checks the Render preview, axis gestures, cancellation, native 2x
output and responsive framing. A visual comparison is saved to
`.test-output/title-camera-comparison.png`.

New projects use the **Original generator models** mode. It preserves source
cuboids, signed dimensions, per-face UVs, kerning, spacer geometry, end caps and
automatic word borders. Native top, bottom and small row transforms retain the
source geometry's behavior, including independent axis scales.

The optional **Closed meshes** mode compiles closed body and contour meshes from
the source front artwork. Its caps share a conforming grid with contour walls;
the border ring never covers body caps. Fonts without source extrusion colors
use generated fallback swatches. This alternative retains manifold geometry
without discarding the original model mode.

Texture minification and magnification use nearest texel sampling. Hardware MSAA
smooths 3D silhouettes without blurring the material itself. WebGL renders on
demand, with depth testing, backface culling and UV-mapped unlit materials, as in
the source generator. Premultiplied alpha and the source's alpha threshold keep
transparent cutouts and antialiased silhouettes free of dark fringes.
Camera changes reuse GPU geometry; no Blockbench or game runtime is required.

Projects retain normalized text, material, shared camera and per-object transform
parameters in `titleData`. A `.bbmodel` export in the Scene tab embeds all
texture atlases and preserves separate row, letter and model-part objects, with shared
vertices welded and per-face UVs preserved,
including hidden objects. Mesh vertices are relative to their exported world
pivots; transformed groups and parts retain usable rotation centers. It can
be opened and edited in Blockbench.
The ordinary MLST, recovery, history, thumbnail and transparent PNG paths remain
in use. Output width is selectable between 1024, 2048 and 4096 pixels. The scene
does not use the pixel-art editor's nearest-neighbor presentation or pixel grid.

The design reference is [Minecraft Title Generator](https://github.com/ewanhowell5195/MinecraftTitleGenerator).
Its plugin code is not bundled. All 13 font entries and variants are bundled
locally at the manifest's pinned commit: Minecraft Ten, Ten v2, Ten Cyrillic,
Five Bold, Five Bold Cyrillic, Five Bold Block, Ten Outline, Dungeons, GUI,
Seven, Five, SGA and Block Serif. Original authors and asset provenance are
recorded in `src/renderer/assets/title_generator/NOTICE.md` and `manifest.json`.
Font-specific height, kerning, spacing and materials come from a centralized
catalog. Each row uses one language: English, Russian or Ukrainian, with automatic
recognition or an explicit choice. Font lists and visual material/overlay galleries
show only native assets for that row. Russian uses the original Minecraft Ten
Cyrillic or Minecraft Five Bold Cyrillic models. Ukrainian uses Minecraft Ten
Cyrillic, whose source includes its complete alphabet. The other eleven fonts
are English-only. No English atlas is remapped onto Cyrillic shapes.

Mixed alphabets within one row are reported before saving or exporting. Existing
text remains editable; it is never silently deleted. Different rows may use
different languages, with independent native fonts and materials. NFC normalization
keeps decomposed Ё/Й/Ї accents together before text limits and selection IDs.

The Logo layout creates a main title, upward-facing subtitle and small edition
line, matching the three distinct roles tested in Blockbench. Stacked lines keep
all rows in the same plane. The only camera projections are Perspective (the default for new projects) and
Orthographic. Existing projects retain their saved projection. Each material loads from local files without contacting external services.

The inspector has Title, Material and Scene sections. Its shared row selector
switches between the entire title and three independently editable rows. A row
can override its font, material, model role, axis scales, spacing, kerning and
appearance; **Inherit shared settings** removes its overrides.

Visual, searchable libraries expose all **309 registered materials and variants,
58 overlays and 148 tileable textures** from the pinned source. Materials also
support two to five gradient stops, smooth/banded gradients, local PNG/JPEG/WebP
atlases or tiles, texture offsets and scale, deterministic rotations/mirroring,
font details, overlays with independent tint/blend/opacity, color correction,
edge/border colors and fading. The operations are baked into the UV atlas, so
rotating or moving a letter does not move its gradient or texture.

Local image imports are embedded in MLST and model exports; they need no network
connection. Invalid images leave the previous document intact. Material loads
are deduplicated, the latest edit wins, and a pending edit cannot be saved before
its resources are ready. Undo/redo can restore an evicted material asynchronously.
The decoded image cache has a 32-megapixel soft budget, retaining active materials
and the boot set. GPU textures are released when they leave the current scene.

Run `npm run test:titles`, `npm run test:titles:precision`, `npm run test:titles:fonts`
`npm run test:titles:materials` and `npm run test:titles:cyrillic` for real Electron scenarios covering 3D camera controls,
per-letter/cuboid pointer selection, independent transforms, visibility/locking,
model export, history, editable file round trips, themes, layout and project creation.

To restore the pinned artwork, run `python scripts/vendor-title-assets.py`. The
script verifies every downloaded source file against the manifest checksum.
The original Cyrillic gallery artwork is bundled alongside its matching atlases;
no generated substitute models, UV lookup atlases or translated previews are used.

Unit checks validate all compiled letters, outward normals, positive volumes,
non-overlapping caps, shared triangle edges in all three row roles, and welded
model exports. The font scenarios select every entry through the actual
inspector, render PNGs, inspect GPU sampler state, and save a visual font sheet
and close-ups at front, back and oblique camera angles to `.test-output`.
The Cyrillic scenarios render all native Cyrillic materials and overlays, validate
per-row languages and filtered galleries, save/reopen MLST, and export self-contained
BBModel textures. Alpha and
document parameters must survive exactly; RGB allows at most one byte level of
normal GPU/canvas rounding at antialiased edges.

`npm run test:titles:audit` exercises delayed and failed history loads, modal
shortcut isolation, physical shortcuts under a Cyrillic keyboard layout, shared
alpha-cache eviction, gesture completion before a save/switch, and camera
preparation with an embedded image. Title history commands expose their before
and after data to the application's existing memory budget. Material identities
use two independent 32-bit accumulators and cached image identities; camera mesh
keys never contain embedded image bytes. The image validation cache uses weak
object keys, so it does not retain closed projects' file strings.

Bottom-row axis scales apply before the row rotation for native and closed
geometry alike. Blank lines have no end caps, background frames or selectable
empty scene objects. Per-font normalization clears unavailable overlay choices
while keeping embedded custom overlays.
Stacked lines flow using their actual pre-transform bounds, so different font
heights, row scales and accents keep the requested gap. Blank lines reserve their
line advance. Manual model transforms still apply after this layout.

For developer-only source conformance, download the official plugin referenced
by `manifest.referencePlugin` and run
`node scripts/compare-title-reference.mjs <downloaded-plugin.js>`. It verifies the
pinned checksum and runs only the two reference model-assembly functions in a
minimal VM with stub model classes. All 13 fonts, three row roles, two axis
scales and two spacing values are compared against native scene cuboids within
1e-8 units (180 cases, including both complete Russian alphabets). The reference plugin is neither bundled nor required at
runtime. This source comparison does not replace live visual comparison with
the full Blockbench application.

## Editing workflow

The inspector has fixed Text, Appearance and Scene tabs and a persistent edit
scope. Only the settings body scrolls. Text is grouped with its row languages;
font choice, layout and letter geometry have separate labelled groups. Font and
material buttons show native visual previews. Galleries support search, category
filters and keyboard navigation. Choosing a scene object exposes a direct action
to edit that row's appearance.

The bundled catalog contains 13 font entries, 309 materials, 58 overlays and
148 tileables, with 913 source checksums and 885 mirrored resource files.
Decorative objects and their resources have been removed. Old MLST documents
remain readable; obsolete decorative records are ignored while text, row
settings and text transforms are retained.

`npm run test:titles:workspace` covers row controls, native materials, legacy
project compatibility, scene serialization, model export and layout across four
themes at 1000×700, 1280×900 and 1920×1080.
