# Textured stylized valley

The habitat and guest landing scene load `/assets/environments/stylized-valley/valley.glb`.
The companion and interface are unchanged. This replaces the coarse Kenney valley
with textured Quaternius vegetation and rocks, a softly shaded clearing, a smaller
lake, flowers, and layered distant mountains. The center stays open for the companion.
The same geometry is lit by the existing day/night cycle.

## Source and rebuilding

Nature meshes: [Quaternius Ultimate Stylized Nature Pack](https://quaternius.com/packs/ultimatestylizednature.html),
CC0 1.0, distributed through [Poly Pizza](https://poly.pizza/bundle/Ultimate-Stylized-Nature-Pack-zyIyYd9yGr).
`License.txt` records provenance. Download the six GLBs listed in `manifest.json`'s
`sources` object into a directory, naming each `<key>.glb` (birch, pine, rocks,
bush, grass, flowers). Only the selected models are included in the shipped asset.

From `app/`, run:

```sh
npm ci
node scripts/assets/build-stylized-valley.mjs /path/to/source-glbs
```

The script produces a deterministic GLB and measured manifest. Set `VALLEY_QA_PATH`
to an absolute path to additionally export an uncompressed copy for inspection.
Sharp is a build-time dependency; texture processing never runs in the browser.

## Runtime budget and lifecycle

- One Meshopt GLB download; no full packs, external texture requests, or normal maps.
- Eight shared textures capped at 256×256; foliage uses alpha testing.
- Static geometry is batched by material. See manifest for actual bytes, triangle
  count and primitive/draw count; these exclude the creature and interface.
- No realtime reflection, fluid simulation, postprocessing, or environment shadow map.
- Cached compressed bytes are parsed into independent GPU resources per viewer.
  Geometry, materials and shared textures are released once on unmount, including
  loads that finish after unmount. A failed download retains the fallback clearing.

Validation includes build/type checking, lifecycle tests, GLTFLoader decode and
CPU renders for portrait and landscape framing. These checks do not establish
mobile GPU performance or replace a device/browser visual check.
