# Entity renders

`src/renderer/assets/entities_minecraft` contains pre-rendered transparent 96×96
PNGs. The editor uses the ordinary resource insertion, search, favorites and
image transformation paths. End users need neither Minecraft nor Java.

Regenerate with a developer JDK compatible with the unpacked vanilla client,
Pillow, and the launcher's library directory:

```powershell
python scripts/generate-minecraft-entities.py "path/to/unpacked/client" --java "path/to/jdk/bin/java.exe" --libraries "path/to/launcher/libraries"
```

`scripts/data/minecraft-entity-models.json` selects the models and texture layers.
The Java helper exports baked ModelPart vertices, UV coordinates, normals and
hierarchical transforms. Python rasterizes a static three-quarter orthographic
view with nearest-neighbor texture sampling. Texture hashes and source version
are recorded in the generated manifest. Geometry export files and the contact
sheet stay in `.test-output`; game classes and runtime dependencies are not bundled.

These are neutral model poses, without game animations, cast shadows or shaders.
Copyright for Minecraft artwork remains with Mojang AB / Microsoft.
